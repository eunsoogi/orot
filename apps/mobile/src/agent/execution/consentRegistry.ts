import type {
  OutboundProcessingRequest,
  ExecutionConsentPort,
} from '@orot/agent-runtime';
import { consentSnapshot } from './consentSnapshot';
import { canReuseConsent } from './consentRevision';

export type ConfirmExecutionConsent = (
  request: OutboundProcessingRequest,
) => Promise<boolean>;

// Exact snapshots stay in memory for mutation guards; durable purpose/data permissions are separate.
export function createExecutionConsentRegistry(
  confirm: ConfirmExecutionConsent,
): ExecutionConsentPort & {
  clear(operationRunId?: string): void;
} {
  const approved = new Map<string, string>();
  return {
    async authorize(request) {
      if (!request.remoteProcessing) return 'authorized';
      if (request.signal.aborted) return 'renewal_required';
      const snapshot = consentSnapshot(request);
      if (!snapshot) return 'renewal_required';
      if (
        canReuseConsent() &&
        approved.get(request.operationRunId) === snapshot
      )
        return 'authorized';

      // An approval for a superseded payload is revoked before asking about its replacement.
      approved.delete(request.operationRunId);
      let confirmed = false;
      try {
        confirmed = await confirm(request);
      } catch {
        return 'renewal_required';
      }
      if (
        !confirmed ||
        request.signal.aborted ||
        consentSnapshot(request) !== snapshot
      ) {
        return 'renewal_required';
      }
      approved.set(request.operationRunId, snapshot);
      return 'authorized';
    },
    clear(operationRunId) {
      if (operationRunId) approved.delete(operationRunId);
      else approved.clear();
    },
  };
}
