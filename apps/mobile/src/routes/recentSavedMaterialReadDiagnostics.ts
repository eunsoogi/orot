import { providerDiagnostic } from '../providers/diagnostics';

type ReadStage =
  | 'recent_records_admission'
  | 'recent_records_source_read'
  | 'recent_records_reproof';
type ReadOutcome = 'started' | 'completed' | 'failed' | 'cancelled';

/** Only fixed tokens reach the existing opt-in native diagnostic sink. */
export function reportRecentReadStage(stage: ReadStage, outcome: ReadOutcome) {
  try {
    providerDiagnostic('storage', stage, outcome);
  } catch {
    // Tracing never changes an admission or protected read result.
  }
}

export function reportRecentReadCompletion(
  stage: ReadStage,
  current: () => boolean,
  successful: boolean,
) {
  try {
    reportRecentReadStage(
      stage,
      !current() ? 'cancelled' : successful ? 'completed' : 'failed',
    );
  } catch {
    // An additional observation may not change the underlying operation.
  }
}

export async function observeRecentReadStage<T>(
  stage: Exclude<ReadStage, 'recent_records_admission'>,
  current: () => boolean,
  task: () => Promise<T>,
) {
  reportRecentReadStage(stage, 'started');
  try {
    const result = await task();
    reportRecentReadCompletion(stage, current, result !== false);
    return result;
  } catch (error) {
    reportRecentReadCompletion(stage, current, false);
    throw error;
  }
}
