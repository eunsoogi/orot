import { View } from 'react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
import { AppText as Text } from '../layout/AppText';
import { AppButton } from '../layout/AppButton';
import { healthReviewText as copy } from '../i18n/healthReview';
import type { HealthReviewState } from './controller';
import { healthReviewStyles as styles } from './styles';

/**
 * Keeps local policy guidance visible beside observations, clarification
 * results, and provider failures.
 */
export function ReviewResult({
  state,
  onSource,
}: {
  state: HealthReviewState;
  onSource: (reference: EvidenceReference) => void;
}) {
  const result = state.result;
  // Keep the initial empty state unbacked so the feedback card appears only when useful.
  const hasContent = Boolean(
    state.safety || state.providerStatus || state.consentDenied || result,
  );
  return (
    <View
      testID="health-review-feedback-surface"
      style={[styles.section, hasContent && styles.feedbackSurface]}
    >
      {state.safety ? (
        <View testID="health-review-safety">
          <Text accessibilityRole="header">{copy.safety}</Text>
          {/* Generated observations do not turn an insufficient policy result into clearance. */}
          {result?.status === 'review' &&
          state.safety.category === 'insufficient_information' ? (
            <Text
              accessibilityRole="alert"
              testID="health-review-safety-insufficient-information"
            >
              {copy.outcomes.needs_clarification}
            </Text>
          ) : null}
          {state.safety.requiredActions.map(action => (
            <Text accessibilityRole="alert" key={action}>
              {copy.actions[action]}
            </Text>
          ))}
          {state.safety.missingInputs.length ? (
            <Text>
              {copy.missing}:{' '}
              {state.safety.missingInputs
                .map(
                  input =>
                    copy.missingInputs[
                      input as keyof typeof copy.missingInputs
                    ] ?? copy.missingInputs.safety_context,
                )
                .join(', ')}
            </Text>
          ) : null}
        </View>
      ) : null}
      {state.providerStatus ? (
        <Text accessibilityRole="alert">{copy.providerUnavailable}</Text>
      ) : null}
      {state.consentDenied ? (
        <Text accessibilityRole="alert" testID="health-review-consent-denied">
          {copy.denied}
        </Text>
      ) : null}
      {result && result.status !== 'review' ? (
        <Text
          accessibilityRole="alert"
          testID={`health-review-${result.status}`}
        >
          {result.status === 'needs_clarification' &&
          result.pending.reason === 'evidence'
            ? copy.evidenceInsufficient
            : copy.outcomes[result.status]}
        </Text>
      ) : null}
      {result?.status === 'review' ? (
        <View testID="health-review-result">
          <Text accessibilityRole="header">{copy.observations}</Text>
          {result.review.observedChanges.map((change, index) => (
            <View key={index}>
              <Text>{change.text}</Text>
              {change.evidenceIds.map(id => {
                const reference = state.invocation?.aliases.get(id);
                return reference ? (
                  <AppButton
                    key={id}
                    title={copy.citation}
                    testID={`health-review-citation-${id}`}
                    variant="list"
                    onPress={() => onSource(reference)}
                  />
                ) : null;
              })}
            </View>
          ))}
          <Text accessibilityRole="header">{copy.unresolved}</Text>
          {result.review.unresolvedItems.map((text, index) => (
            <Text key={index}>{text}</Text>
          ))}
          <Text accessibilityRole="header">{copy.questions}</Text>
          {result.review.questions.map((text, index) => (
            <Text key={index}>{text}</Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}
