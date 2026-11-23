import { providerDiagnostic } from '../../providers/diagnostics';
import type { Stage } from '../../providers/diagnosticTypes';

type DataStage = Extract<Stage, `daily_report_data_${string}`>;

/** Observe elapsed boundaries only. Never attach source details or let the optional sink change a report. */
export async function observeDailyReportData<T>(
  stage: DataStage,
  signal: AbortSignal,
  work: () => Promise<T>,
) {
  const report = (
    outcome: 'started' | 'completed' | 'cancelled' | 'failed',
  ) => {
    try {
      providerDiagnostic('daily_report', stage, outcome);
    } catch {
      // Observation is not an authorization or a production failure.
    }
  };
  report('started');
  try {
    const result = await work();
    report(signal.aborted ? 'cancelled' : 'completed');
    return result;
  } catch (error) {
    report(signal.aborted ? 'cancelled' : 'failed');
    throw error;
  }
}

/** The fresh report owns this initial snapshot; an unchanged reproof is observed separately. */
export function observeInitialDailyReportSnapshot<T>(
  signal: AbortSignal,
  work: () => Promise<T>,
) {
  return observeDailyReportData('daily_report_data_snapshot', signal, work);
}

/** No extra read. The already-required local proof after provider output is not inference time. */
export function postProviderProof<T>(
  signal: AbortSignal,
  refresh: (signal: AbortSignal) => Promise<T>,
) {
  return observeDailyReportData('daily_report_data_post_provider', signal, () =>
    refresh(signal),
  );
}
