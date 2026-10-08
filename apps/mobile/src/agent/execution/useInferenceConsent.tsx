import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type {
  ExecutionConsentPort,
  OutboundProcessingRequest,
} from '@orot/agent-runtime';
import { createExecutionConsentRegistry } from './consentRegistry';
import InferenceDisclosureSheet from './InferenceDisclosureSheet';

interface PendingConfirmation {
  readonly request: OutboundProcessingRequest;
  readonly resolve: (approved: boolean) => void;
  readonly onAbort: () => void;
}

export interface InferenceConsentController {
  readonly consent: ExecutionConsentPort;
  readonly disclosureSheet: ReactElement | null;
}

/** Binds the shared registry to one visible, fail-closed remote-request prompt. */
export function useInferenceConsent(): InferenceConsentController {
  const [pendingRequest, setPendingRequest] =
    useState<OutboundProcessingRequest | null>(null);
  const pending = useRef<PendingConfirmation | null>(null);
  const mounted = useRef(false);

  const finish = useCallback((approved: boolean) => {
    const current = pending.current;
    if (!current) return;

    pending.current = null;
    current.request.signal.removeEventListener('abort', current.onAbort);
    if (mounted.current) setPendingRequest(null);
    current.resolve(approved && !current.request.signal.aborted);
  }, []);

  const confirm = useCallback(
    (request: OutboundProcessingRequest) =>
      new Promise<boolean>(resolve => {
        if (!mounted.current || request.signal.aborted || pending.current) {
          resolve(false);
          return;
        }

        const onAbort = () => finish(false);
        pending.current = { request, resolve, onAbort };
        request.signal.addEventListener('abort', onAbort, { once: true });
        // A second check closes the race between the initial check and listener registration.
        if (request.signal.aborted) {
          finish(false);
          return;
        }
        setPendingRequest(request);
      }),
    [finish],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const current = pending.current;
      if (!current) return;
      pending.current = null;
      current.request.signal.removeEventListener('abort', current.onAbort);
      // An unmounted disclosure surface cannot grant permission to send its request.
      current.resolve(false);
    };
  }, []);

  const consent = useMemo(
    () => createExecutionConsentRegistry(confirm),
    [confirm],
  );
  const disclosureSheet = (
    <InferenceDisclosureSheet request={pendingRequest} onDecision={finish} />
  );

  return { consent, disclosureSheet };
}
