import {
  isExecutionConsentCurrent,
  type ExecutionConsentPort,
} from '@orot/agent-runtime';
import type { SelectedAiResolution } from '../aiFeatures/integration/provider';

type ReadyModel = Extract<SelectedAiResolution, { status: 'ready' }>;

/** Bind the running review to the model selection that admitted it. Model
 * availability and selection invalidation never imply withdrawal of consent. */
export function createEncounterStartAdmission(
  selected: ReadyModel,
  original: ExecutionConsentPort,
  requireLocalWitness: boolean,
) {
  const witness = selected.onDeviceSelectionWitness;
  let selectionRetired = false;
  const selectionCurrent = () => {
    if (selectionRetired) return false;
    try {
      if (
        (witness?.isCurrent() ??
          (selected.remoteProcessing || !requireLocalWitness)) === true
      )
        return true;
    } catch {
      // A missing or broken witness cannot be reused later in this attempt.
    }
    selectionRetired = true;
    return false;
  };
  let denied = false;
  const consent: ExecutionConsentPort = {
    isAuthorizationCurrent(request) {
      if (!selectionCurrent()) return false;
      const current = isExecutionConsentCurrent(original, request);
      if (!current && selected.remoteProcessing) denied = true;
      return current;
    },
    subscribeAuthorizationInvalidation(request, listener) {
      const stopConsent = original.subscribeAuthorizationInvalidation?.(
        request,
        listener,
      );
      const stopSelection = witness?.subscribe(() => {
        if (!selectionCurrent()) listener();
      });
      return () => {
        stopConsent?.();
        stopSelection?.();
      };
    },
    async authorize(request) {
      const result = await original.authorize(request);
      if (result !== 'authorized' && selected.remoteProcessing) denied = true;
      return result;
    },
  };
  return { selectionCurrent, denied: () => denied, consent };
}
