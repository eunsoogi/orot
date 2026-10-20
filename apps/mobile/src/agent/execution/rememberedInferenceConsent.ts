import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import type { ConfirmExecutionConsent } from './consentRegistry';
import { consentSnapshot } from './consentSnapshot';
import { canReuseConsent, consentRevision } from './consentRevision';
import { consentPermissionKey } from './consentPermissionKey';

export interface InferenceConsentReceipts {
  has(digest: string): Promise<boolean>;
  save(digest: string, stillValid: () => boolean): Promise<void>;
  clear(): Promise<void>;
}

/** Reuse a declared purpose/data permission while still guarding the exact in-flight payload against mutation. */
export function createRememberedInferenceConfirmation(
  confirm: ConfirmExecutionConsent,
  options: {
    readonly receipts: InferenceConsentReceipts;
    readonly digest: (snapshot: string) => Promise<string>;
    readonly onUnavailable?: () => void;
  },
): ConfirmExecutionConsent {
  return async (request: OutboundProcessingRequest) => {
    const snapshot = consentSnapshot(request, false);
    const revision = consentRevision();
    const valid = () =>
      !request.signal.aborted &&
      revision === consentRevision() &&
      consentSnapshot(request, false) === snapshot;
    if (!snapshot || !valid()) return false;
    const permission = consentPermissionKey(request);
    // Callers without a declared reusable boundary keep explicit per-request consent.
    if (!permission) return (await confirm(request)) && valid();
    let digest: string | undefined;
    try {
      digest = await options.digest(permission);
      if (!/^[a-f0-9]{64}$/.test(digest))
        throw new Error('Invalid consent digest');
      if (canReuseConsent() && (await options.receipts.has(digest)))
        return valid();
    } catch {
      digest = undefined;
      options.onUnavailable?.();
    }
    if (!valid() || !(await confirm(request)) || !valid()) return false;
    if (digest && canReuseConsent()) {
      try {
        await options.receipts.save(digest, valid);
      } catch {
        // Explicit permission still covers this request; failed persistence grants no automatic reuse.
        options.onUnavailable?.();
      }
    }
    return valid();
  };
}
