import type { LanguageModelRequest } from '@orot/model-runtime';
import type { LanguageModelStreamEvent } from '@orot/model-runtime';
import { referencesFromBatch } from './evidence';
import { callModel, observeUntilAbort } from './modelCall';
import type { ModelCallOutcome } from './modelCall';
import type { ExecutionConsentPort } from './contracts';
import { canceled, stop } from './runtimeContext';
import type { RuntimeContext } from './runtimeContext';

/** Lets an abort stop local reads or network queries before an evidence adapter starts. */
export function deferEvidenceAdapter<TResult>(
  signal: AbortSignal,
  dispatch: () => Promise<TResult>,
): Promise<TResult> {
  return Promise.resolve().then(() => {
    if (signal.aborted) return new Promise<TResult>(() => {});
    return dispatch();
  });
}

/** Keeps evidence-backed payloads current across consent waits and provider calls. */
export async function revalidateCurrentEvidence<TResult>(
  context: RuntimeContext<TResult>,
  providerStop: 'not_started' | 'underlying_call_unconfirmed',
): Promise<boolean> {
  const { options, signal } = context;
  const references = referencesFromBatch(context.currentEvidence);
  if (references.length === 0) return true;
  if (signal.aborted) {
    canceled(context, providerStop);
    return false;
  }

  const revalidation = deferEvidenceAdapter(signal, () =>
    options.revalidateEvidence(references, signal),
  );
  const result = await observeUntilAbort(revalidation, signal);
  if (result.kind === 'cancelled') canceled(context, providerStop);
  else if (result.kind !== 'value' || !result.value) {
    stop(context, 'Evidence changed while the model request was in progress.', 'stale_evidence');
  }
  return result.kind === 'value' && result.value === true;
}

/** Keeps evidence-backed payloads current across consent waits and provider calls. */
export async function callModelWithEvidenceFreshness<TResult>(
  context: RuntimeContext<TResult>,
  request: LanguageModelRequest,
  onTextEvent?: (
    event: Extract<LanguageModelStreamEvent, { type: 'text_delta' | 'text_snapshot' }>,
  ) => void,
): Promise<ModelCallOutcome | undefined> {
  const { options, signal } = context;
  const ensureCurrent = (providerStop: 'not_started' | 'underlying_call_unconfirmed') =>
    revalidateCurrentEvidence(context, providerStop);

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
  if (options.photoInput) {
    let before: string;
    try {
      before = JSON.stringify({ request, evidence: context.currentEvidence });
    } catch {
      return { status: 'consent_required' };
    }
    const approval = await observeUntilAbort(
      deferEvidenceAdapter(signal, () =>
        options.photoInput!.consent.authorize({
          operationRunId: options.execution.operationRunId,
          providerId: options.execution.providerId,
          modelId: options.execution.modelId,
          recipient: options.execution.recipient,
          remoteProcessing: options.execution.remoteProcessing,
          ...(options.execution.consentScope
            ? { consentScope: options.execution.consentScope }
            : {}),
          allowedScope: options.execution.allowedScope,
          payload: request,
          signal,
        }),
      ),
      signal,
    );
    if (approval.kind === 'cancelled') {
      canceled(context, 'not_started');
      return;
    }
    if (approval.kind !== 'value' || approval.value !== 'authorized')
      return { status: 'consent_required' };
    try {
      if (before !== JSON.stringify({ request, evidence: context.currentEvidence }))
        return { status: 'consent_required' };
    } catch {
      return { status: 'consent_required' };
    }
    if (!(await ensureCurrent('not_started'))) return;
  }
  // A source fence is required even when private preview text is deliberately withheld.
  if (context.beforeTaskStream) {
    let snapshot: string;
    try {
      snapshot = JSON.stringify({ request, evidence: context.currentEvidence });
    } catch {
      stop(context, 'The conversation stream could not be prepared safely.', 'stale_evidence');
      return;
    }
    // A failed local fence must stop before provider dispatch; never expose the callback error.
    const prepared = await observeUntilAbort(
      deferEvidenceAdapter(signal, () =>
        context.beforeTaskStream!({ request, evidence: context.currentEvidence }, signal),
      ),
      signal,
    );
    if (prepared.kind === 'cancelled') canceled(context, 'not_started');
    else if (prepared.kind !== 'value')
      stop(context, 'The conversation stream could not be prepared safely.', 'stale_evidence');
    if (prepared.kind !== 'value') return;
    try {
      if (snapshot !== JSON.stringify({ request, evidence: context.currentEvidence })) {
        stop(
          context,
          'The conversation stream input changed during preparation.',
          'stale_evidence',
        );
        return;
      }
    } catch {
      stop(context, 'The conversation stream could not be prepared safely.', 'stale_evidence');
      return;
    }
    if (!(await ensureCurrent('not_started'))) return;
  }
  const outcome = await callModel(
    options.provider,
    request,
    options.execution,
    consent,
    signal,
    undefined,
    onTextEvent,
  );
  if (staleAfterConsent || context.outcome) return;
  if (outcome.status !== 'response') return outcome;
  return (await ensureCurrent('underlying_call_unconfirmed')) ? outcome : undefined;
}
