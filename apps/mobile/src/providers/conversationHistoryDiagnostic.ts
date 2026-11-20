import { providerDiagnostic } from './diagnostics';
import { NativeModules } from 'react-native';

export type HistoryValidationCost =
  | 'artifact_read_admission'
  | 'artifact_read_settlement'
  | 'artifact_read_setup'
  | 'artifact_session_lease'
  | 'artifact_root_row'
  | 'artifact_root_decode'
  | 'artifact_parent_row'
  | 'artifact_retained_source'
  | 'artifact_summary_parent'
  | 'artifact_source_authority'
  | 'artifact_parent_decode'
  | 'artifact_parent_fingerprint'
  | 'artifact_report_calendar'
  | 'artifact_report_snapshot'
  | 'artifact_report_fingerprint';

/** Each token names a local read boundary, never an ID, record type or error message. */
export type ConversationHistoryStage =
  | 'history_timeline'
  | 'history_turns'
  | 'history_artifacts'
  | 'artifact_initial_validation'
  | 'artifact_source_hydration'
  | 'artifact_final_validation'
  | HistoryValidationCost
  | 'history_tool_read'
  | 'history_tool_restore'
  | 'history_session_recheck_before_assembly'
  | 'history_session_recheck_after_assembly'
  | 'history_tool_recheck_before_assembly'
  | 'history_tool_recheck_final'
  | 'history_cold_previews'
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

/** New fence-only spans must not add promise hops or bridge calls on normal restores. */
export function observeOptInConversationHistory<T>(
  stage: ConversationHistoryStage,
  work: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  let enabled = false;
  try {
    enabled = NativeModules?.OrotProviderDiagnostics?.enabled === true;
  } catch {
    // If the bridge is inaccessible, leave the original operation untouched.
  }
  return enabled ? observeConversationHistory(stage, work, signal) : work();
}
