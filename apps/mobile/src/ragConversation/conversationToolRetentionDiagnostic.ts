import { reportToolCaptureFailure } from './conversationToolCaptureFailure';
import { providerDiagnostic } from '../providers/diagnostics';
import { RetainedSourceInvalidError } from '../aiFeatures/integration/retainedSourceError';

type Stage =
  | 'tool_event_adapter'
  | 'tool_event_capture'
  | 'tool_event_write'
  | 'tool_event_bind'
  | 'tool_event_discard';
/** Observe the original retention operation, never its identities, payload or exception text.
 * Failures still propagate unchanged; these opt-in tokens distinguish pre/post-write failures. */
export async function observeToolRetention<T>(
  stage: Stage,
  work: () => Promise<T>,
): Promise<T> {
  const report = (
    outcome: 'started' | 'completed' | 'stale_evidence' | 'failed',
  ) => {
    try {
      providerDiagnostic('storage', stage, outcome);
    } catch {
      /* Optional diagnostics cannot alter retention or its original failure. */
    }
  };
  report('started');
  try {
    const result = await work();
    report('completed');
    return result;
  } catch (error) {
    report(
      error instanceof RetainedSourceInvalidError ? 'stale_evidence' : 'failed',
    );
    if (stage === 'tool_event_capture') reportToolCaptureFailure(error);
    throw error;
  }
}
