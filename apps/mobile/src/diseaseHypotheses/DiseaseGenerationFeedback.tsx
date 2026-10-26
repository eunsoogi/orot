import { AppText } from '../layout/AppText';
import { DiseaseGenerationError } from './DiseaseGenerationError';
import { getDiseaseHypothesisCopy } from './copy';
import type { DiseaseGenerationState } from './useDiseaseHypothesisGeneration';

/** Distinguish permission stops from insufficient evidence and provider failures.
 * Only the active request stops; safe partial text remains owned by the screen. */
export function DiseaseGenerationFeedback({
  state,
  summary,
  onOpenProviderSelection,
}: {
  readonly state: DiseaseGenerationState;
  readonly summary: boolean;
  readonly onOpenProviderSelection?: () => void;
}) {
  const copy = getDiseaseHypothesisCopy();
  if (state.status === 'cancelled')
    return (
      <AppText testID="disease-hypotheses-cancelled">{copy.cancelled}</AppText>
    );
  if (state.status === 'consent_required')
    return (
      <AppText
        accessibilityLiveRegion="polite"
        testID="disease-hypotheses-consent-required"
      >
        {copy.consentRequired}
      </AppText>
    );
  if (state.status === 'insufficient')
    return (
      <AppText testID="disease-hypotheses-insufficient">
        {summary ? copy.summaryInsufficient : copy.insufficient}
      </AppText>
    );
  if (state.status === 'error')
    return (
      <DiseaseGenerationError
        code={state.providerErrorCode}
        summary={summary}
        onOpenProviderSelection={onOpenProviderSelection}
      />
    );
  return null;
}
