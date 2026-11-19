import { providerDiagnostic } from './diagnostics';
import { NativeModules } from 'react-native';

type HistoryValidationCost =
  | 'artifact_source_authority'
  | 'artifact_parent_decode'
  | 'artifact_parent_fingerprint'
  | 'artifact_report_calendar'
  | 'artifact_report_snapshot'
  | 'artifact_report_fingerprint';

type HistoryStartupMilestone =
  'history_startup_js_registered' | 'history_startup_page_requested';
type HistoryStartupWork =
  | 'history_startup_backup_key'
  | 'history_startup_encrypted_open'
  | 'history_startup_period_guards'
  | 'history_startup_summary_setup'
  | 'history_startup_conversation_storage'
  | 'history_startup_session_recovery'
  | 'history_startup_session_lease'
  | 'history_startup_model_selection'
  | 'history_startup_saved_selection_read'
  | 'history_startup_model_availability'
  | 'history_startup_account_eligibility'
  | 'history_startup_model_catalog'
  | 'history_startup_continuous_session'
  | 'history_startup_session_attachment';

/** Each token names a local read boundary, never an ID, record type or error message. */
export type ConversationHistoryStage =
  | 'history_timeline'
  | 'history_turns'
  | 'history_artifacts'
  | 'artifact_initial_validation'
  | 'artifact_source_hydration'
  | 'artifact_final_validation'
  | HistoryValidationCost
  | HistoryStartupMilestone
  | HistoryStartupWork
  | 'history_tool_read'
  | 'history_tool_restore'
  | 'history_tasks'
  | 'history_recheck'
  | 'history_transcript_layout';

export function historyValidationCostEnabled() {
  try {
    return (
      NativeModules.OrotProviderDiagnostics?.historyValidationCostEnabled ===
      true
    );
  } catch {
    return false;
  }
}

function reportHistory(
  stage: ConversationHistoryStage,
  outcome: 'started' | 'completed' | 'failed' | 'cancelled',
) {
  try {
    providerDiagnostic('rag', stage, outcome);
  } catch {
    // An unavailable opt-in sink must not break a protected local read.
  }
}

/** Detailed startup tokens distinguish registration and page admission without exposing data. */
export function reportHistoryStartupMilestone(stage: HistoryStartupMilestone) {
  if (historyValidationCostEnabled()) reportHistory(stage, 'completed');
}

/** Profile startup only during the separate detailed run. Normal callers keep their original promise. */
export function observeHistoryStartup<T>(
  stage: HistoryStartupWork,
  work: () => Promise<T>,
): Promise<T> {
  return historyValidationCostEnabled()
    ? observeConversationHistory(stage, work)
    : work();
}

/** Start a closed span in an opt-in history read without wrapping awaited queries. */
export function startHistoryValidationCost(stage: HistoryValidationCost) {
  reportHistory(stage, 'started');
  return (outcome: 'completed' | 'failed') => reportHistory(stage, outcome);
}

/** Measure synchronous calendar and snapshot work without scheduling another task. */
export function measureHistoryValidationCost<T>(
  stage: HistoryValidationCost,
  work: () => T,
): T {
  const finish = startHistoryValidationCost(stage);
  try {
    const result = work();
    finish('completed');
    return result;
  } catch (error) {
    finish('failed');
    throw error;
  }
}

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
  reportHistory(stage, 'started');
  try {
    const result = await work();
    reportHistory(stage, signal?.aborted ? 'cancelled' : 'completed');
    return result;
  } catch (error) {
    reportHistory(stage, signal?.aborted ? 'cancelled' : 'failed');
    throw error;
  }
}
