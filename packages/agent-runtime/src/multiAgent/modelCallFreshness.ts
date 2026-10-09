import type { LanguageModelRequest } from '@orot/model-runtime';
import { referencesFromBatch } from './evidence';
import { callModel, observeUntilAbort } from './modelCall';
import type { ModelCallOutcome } from './modelCall';
import type { ExecutionConsentPort } from './contracts';
import { canceled, stop } from './runtimeContext';
import type { RuntimeContext } from './runtimeContext';

/** Keeps evidence-backed payloads current across consent waits and provider calls. */
export async function callModelWithEvidenceFreshness<TResult>(
  context: RuntimeContext<TResult>,
  request: LanguageModelRequest,
): Promise<ModelCallOutcome | undefined> {
  const { options, signal } = context;
  const references = referencesFromBatch(context.currentEvidence);
  const ensureCurrent = async (providerStop: 'not_started' | 'underlying_call_unconfirmed') => {
    if (references.length === 0) return true;
    let revalidation: Promise<boolean>;
    try {
      revalidation = options.revalidateEvidence(references, signal);
    } catch {
      stop(context, 'Evidence freshness could not be confirmed.', 'stale_evidence');
      return false;
    }
    const result = await observeUntilAbort(revalidation, signal);
    if (result.kind === 'cancelled') canceled(context, providerStop);
    else if (result.kind !== 'value' || !result.value) {
      stop(context, 'Evidence changed while the model request was in progress.', 'stale_evidence');
    }
    return result.kind === 'value' && result.value;
  };

  let staleAfterConsent = false;
  const consent: ExecutionConsentPort = {
    authorize: async (outbound) => {
      const decision = await options.consent.authorize(outbound);
      if (decision !== 'authorized') return decision;
      if (!(await ensureCurrent('not_started'))) {
        staleAfterConsent = true;
        return 'renewal_required';
      }
      return decision;
    },
  };

  if (!options.execution.remoteProcessing && !(await ensureCurrent('not_started'))) return;
  const outcome = await callModel(options.provider, request, options.execution, consent, signal);
  if (staleAfterConsent || context.outcome) return;
  if (outcome.status !== 'response') return outcome;
  return (await ensureCurrent('underlying_call_unconfirmed')) ? outcome : undefined;
}
