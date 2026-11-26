import { providerDiagnostic } from '../providers/diagnostics';
import type { Outcome, Stage } from '../providers/diagnosticTypes';
import type { ReviewDiagnosticAttempt } from './diagnostics';

type Failure = Parameters<ReviewDiagnosticAttempt['capture']>[0];
const outcomes = {
  workflow_unavailable: 'unavailable',
  workflow_invalid_output: 'invalid_output',
  workflow_budget_exceeded: 'budget_exceeded',
  workflow_consent_required: 'consent_required',
  workflow_stale_evidence: 'stale_evidence',
  workflow_cancelled: 'cancelled',
  workflow_needs_clarification: 'needs_clarification',
} as const;

function report(stage: Stage, outcome: Outcome) {
  try {
    providerDiagnostic('storage', stage, outcome);
  } catch {
    // Observability cannot change protection, selection or extraction.
  }
}

/** Production Start exposes only failure boundaries through the opt-in sink.
 * The synthetic harness remains separate and never lends its counters to live code. */
export function createEncounterStartDiagnostics() {
  return {
    stage: (_: Parameters<ReviewDiagnosticAttempt['stage']>[0]) => {},
    unavailable(
      stage:
        | Parameters<ReviewDiagnosticAttempt['unavailable']>[0]
        | 'native_admission',
    ) {
      if (stage === 'provider_selection')
        report('encounter_review_selection', 'unavailable');
      if (stage === 'native_admission')
        report('encounter_review_native_admission', 'unavailable');
    },
    capture(failure: Failure) {
      if (
        failure.stage !== 'extraction_result' ||
        !Object.hasOwn(outcomes, failure.category)
      )
        return;
      const outcome = outcomes[failure.category as keyof typeof outcomes];
      if (outcome) report('encounter_review_extraction', outcome);
    },
  };
}
