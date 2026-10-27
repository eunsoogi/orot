import { View } from 'react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
import { AppText as Text } from '../layout/AppText';
import { AppButton } from '../layout/AppButton';
import { healthReviewText as copy } from '../i18n/healthReview';
import type { HealthReviewState } from './controller';
import { healthReviewStyles as styles } from './styles';

/** Policy guidance is a separate local section and remains visible during clarification/provider failure. */
export function ReviewResult({
  state,
  onSource,
}: {
  state: HealthReviewState;
  onSource: (reference: EvidenceReference) => void;
}) {
  const result = state.result;
  return (
    <View style={styles.section}>
      {state.safety ? (
        <View testID="health-review-safety">
          <Text accessibilityRole="header">{copy.safety}</Text>
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
          {copy.outcomes[result.status]}
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
