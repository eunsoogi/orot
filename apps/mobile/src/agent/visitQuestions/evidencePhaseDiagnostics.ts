import { providerDiagnostic } from '../../providers/diagnostics';

type EvidencePhase =
  | 'evidence_appointment'
  | 'evidence_period'
  | 'evidence_records'
  | 'evidence_memory'
  | 'evidence_presentation';

/** Fixed phase boundaries identify reread latency without recording IDs, queries, values or results. */
export async function observeVisitEvidencePhase<T>(
  phase: EvidencePhase,
  work: () => Promise<T>,
): Promise<T> {
  const report = (event: 'started' | 'completed' | 'failed') => {
    try {
      providerDiagnostic('visit', phase, event);
    } catch {
      // Optional diagnostics must never bypass a source fence or change its result.
    }
  };
  report('started');
  try {
    const result = await work();
    // Completed means the promise settled, not that the source passed validation.
    report('completed');
    return result;
  } catch (error) {
    report('failed');
    throw error;
  }
}
