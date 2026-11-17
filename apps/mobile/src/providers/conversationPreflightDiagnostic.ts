import { providerDiagnostic } from './diagnostics';

type Boundary = 'model' | 'history';

/** Observe only closed stages/outcomes. Optional diagnostics never change the
 * boolean, exception, or cancellation semantics of the caller-owned preflight. */
export async function observeConversationPreflight(
  boundary: Boundary,
  work: () => Promise<boolean>,
  signal?: AbortSignal,
): Promise<boolean> {
  const stage =
    boundary === 'model'
      ? 'conversation_model_preflight'
      : 'conversation_history_preflight';
  const report = (
    outcome: 'started' | 'completed' | 'failed' | 'cancelled',
  ) => {
    try {
      providerDiagnostic('rag', stage, outcome);
    } catch {
      // A disabled or broken native sink cannot replace the original outcome.
    }
  };
  report('started');
  try {
    const result = await work();
    report(signal?.aborted ? 'cancelled' : result ? 'completed' : 'failed');
    return result;
  } catch (error) {
    report(signal?.aborted ? 'cancelled' : 'failed');
    throw error;
  }
}
