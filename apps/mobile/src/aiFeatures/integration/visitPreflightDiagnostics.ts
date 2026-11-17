import { providerDiagnostic } from '../../providers/diagnostics';

type PreflightPhase =
  | 'preflight_appointment'
  | 'preflight_selection'
  | 'preflight_saved'
  | 'preflight_opening'
  | 'preflight_context'
  | 'preflight_public'
  | 'preflight_artifacts';

/** Opt-in fixed boundaries only. Never report values, identifiers, errors or content.
 * Completed means settlement, not success; overlapping phases must not be summed. */
export async function observeVisitPreflight<T>(
  phase: PreflightPhase,
  work: () => Promise<T>,
): Promise<T> {
  const report = (event: 'started' | 'completed' | 'failed') => {
    try {
      providerDiagnostic('visit', phase, event);
    } catch {
      // Optional native diagnostics cannot change preparation or consent behavior.
    }
  };
  report('started');
  try {
    const value = await work();
    report('completed');
    return value;
  } catch (error) {
    report('failed');
    throw error;
  }
}
