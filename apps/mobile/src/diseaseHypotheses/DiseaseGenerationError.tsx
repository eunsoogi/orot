import type { ProviderErrorCode } from '@orot/model-runtime';
import { AppButton } from '../layout/AppButton';
import { AppText } from '../layout/AppText';
import { styles } from './DiseaseHypothesesScreen.styles';
import { getDiseaseHypothesisCopy } from './copy';

/** Failure text and recovery retain the explicitly chosen operation; refusal never becomes missing-record advice. */
export function DiseaseGenerationError({
  code,
  summary,
  onOpenProviderSelection,
}: {
  readonly code?: ProviderErrorCode;
  readonly summary: boolean;
  readonly onOpenProviderSelection?: () => void;
}) {
  const copy = getDiseaseHypothesisCopy();
  return (
    <>
      <AppText accessibilityRole="alert" style={styles.error}>
        {code === 'safety_refusal'
          ? copy.safetyRefusal
          : code === 'unsupported_input'
            ? copy.unsupportedInput
            : summary
              ? copy.summaryError
              : copy.error}
      </AppText>
      {code === 'safety_refusal' && onOpenProviderSelection ? (
        <AppButton
          testID="disease-hypotheses-select-provider"
          onPress={onOpenProviderSelection}
          title={copy.selectProvider}
        />
      ) : null}
    </>
  );
}
