import { providerDiagnostic } from './diagnostics';

/** Each token names a local read boundary, never an ID, record type or error message. */
export type ConversationHistoryStage =
  | 'history_timeline'
  | 'history_turns'
  | 'history_artifacts'
  | 'artifact_initial_validation'
  | 'artifact_source_hydration'
  | 'artifact_final_validation'
  | 'history_tool_read'
  | 'history_tool_restore'
  | 'history_tasks'
  | 'history_recheck'
  | 'history_transcript_layout';

/** Native row layout observes presentation after validation. Hit testing and
 * request preflight have separate boundaries and are not inferred from layout. */
export function reportRestoredTranscriptLayout() {
  try {
    providerDiagnostic('rag', 'history_transcript_layout', 'completed');
  } catch {
    // Diagnostics must not alter transcript layout or reading position.
  }
}

/** Optional diagnostics cannot change protected-read results or the exact original error. */
export async function observeConversationHistory<T>(
  stage: ConversationHistoryStage,
  work: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const report = (
    outcome: 'started' | 'completed' | 'failed' | 'cancelled',
  ) => {
    try {
      providerDiagnostic('rag', stage, outcome);
    } catch {
      // An unavailable opt-in sink must not break a protected local read.
    }
  };
  report('started');
  try {
    const result = await work();
    report(signal?.aborted ? 'cancelled' : 'completed');
    return result;
  } catch (error) {
    report(signal?.aborted ? 'cancelled' : 'failed');
    throw error;
  }
}
