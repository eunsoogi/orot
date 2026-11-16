import { providerDiagnostic } from '../../providers/diagnostics';
import type { Feature, Outcome, Stage } from '../../providers/diagnosticTypes';

/** Fixed tokens only, through the existing native opt-in allowlist. Delivery means
 * the observer accepted an event, not proof of pixels or VoiceOver presentation. */
export function reportOpening(
  stage: Stage,
  outcome: Outcome,
  feature: Feature = 'rag',
) {
  try {
    providerDiagnostic(feature, stage, outcome);
  } catch {
    // Diagnostics cannot change opening, final-task or cancellation behavior.
  }
}
