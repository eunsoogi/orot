import type {
  EvidenceBatch,
  EvidenceSearchOutcome,
  EvidenceSearchRequest,
  EvidenceSearchRuntime,
  EvidenceSearchTool,
} from './evidenceContracts';
import { canonicalJson, utf8ByteLength } from './protocol';
import { referencesFromBatch, validateEvidenceBatch } from './evidence';
import { observeUntilAbort } from './operationObservation';
import type { RuntimeContext } from './runtimeContext';

/** Query approval is separate from a durable dispatch intent; only the former may safely pause. */
export async function journaledEvidenceSearch<TResult>(
  context: RuntimeContext<TResult>,
  tool: EvidenceSearchTool,
  request: EvidenceSearchRequest,
  runtime?: EvidenceSearchRuntime,
): Promise<EvidenceSearchOutcome | { readonly status: 'paused' }> {
  const journal = context.options.operationJournal;
  if (
    tool.execution !== 'external_read_only' ||
    !journal?.loadPrepared ||
    !tool.prepareAuthorizedSearch ||
    !context.options.checkpointer ||
    !context.pause
  ) {
    return tool.search(request, runtime);
  }
  const identity = {
    operationId: `${request.operationKey}:search`,
    input: canonicalJson({
      toolId: tool.id,
      execution: context.options.execution,
      request: { ...request, signal: undefined },
    }),
    evidenceReferences: referencesFromBatch(context.currentEvidence),
  };
  const saved = await journal.loadOrCreate(identity);
  if (saved.status === 'completed') {
    const batch = JSON.parse(saved.result) as EvidenceBatch;
    if (
      utf8ByteLength(saved.result) > request.maxPayloadBytes ||
      validateEvidenceBatch(batch, request.allowedScope, context.options.execution.budget) ||
      !(await context.options.revalidateEvidence(referencesFromBatch(batch), context.signal))
    ) {
      throw new Error('Completed evidence is no longer current.');
    }
    return batch;
  }
  if (saved.status !== 'ready')
    throw new Error('External dispatch outcome cannot be safely replayed.');
  const approval = context.pause.approvalSignal(request.signal);
  const notify = (waiting: boolean) => {
    try {
      context.onApprovalWait?.(waiting);
    } catch {
      /* UI is not authority. */
    }
  };
  try {
    notify(true);
    const observed = await observeUntilAbort(
      tool.prepareAuthorizedSearch({ ...request, signal: approval.signal }, runtime),
      approval.signal,
    );
    approval.finishApproval();
    notify(false);
    if (approval.signal.aborted && !request.signal.aborted) return { status: 'paused' as const };
    if (
      observed.kind !== 'value' ||
      observed.value.status !== 'authorized' ||
      request.signal.aborted
    ) {
      return { status: 'consent_required' as const };
    }
    const claim = await journal.begin({ ...identity, revision: saved.revision });
    if (claim.status !== 'claimed') throw new Error('External dispatch ownership was invalidated.');
    const result = await observed.value.dispatch();
    if (!('status' in result)) {
      const raw = JSON.stringify(result);
      if (
        utf8ByteLength(raw) > request.maxPayloadBytes ||
        validateEvidenceBatch(result, request.allowedScope, context.options.execution.budget) ||
        !(await journal.complete({ ...identity, claim: claim.claim, result: raw }))
      ) {
        throw new Error('External evidence could not be saved safely.');
      }
    }
    return result;
  } finally {
    notify(false);
    approval.dispose();
  }
}
