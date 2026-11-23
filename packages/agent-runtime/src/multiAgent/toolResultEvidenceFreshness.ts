import type { EvidenceBatch } from './contracts';
import { referencesFromBatch } from './evidence';
import { observeModelStage } from './modelStageDiagnostics';
import { observeUntilAbort } from './operationObservation';
import { canceled, stop, type RuntimeContext } from './runtimeContext';

export async function evidenceIsFresh<TResult>(
  context: RuntimeContext<TResult>,
  batch: EvidenceBatch,
): Promise<boolean> {
  try {
    // Observe the wait after retrieval separately from both search and provider admission.
    const guard = () =>
      observeUntilAbort(
        context.options.revalidateEvidence(referencesFromBatch(batch), context.signal),
        context.signal,
      );
    const observe = context.options.onModelStage;
    const observed = await (observe
      ? observeModelStage(observe, 'tool_result_evidence_check', guard)
      : guard());
    if (observed.kind === 'cancelled') {
      canceled(context);
      return false;
    }
    if (observed.kind === 'error') {
      stop(context, 'Evidence freshness could not be confirmed.', 'stale_evidence');
      return false;
    }
    if (observed.value) return true;
    stop(context, 'One or more evidence sources changed during the run.', 'stale_evidence');
  } catch {
    if (context.signal.aborted) canceled(context);
    else stop(context, 'Evidence freshness could not be confirmed.', 'stale_evidence');
  }
  return false;
}
