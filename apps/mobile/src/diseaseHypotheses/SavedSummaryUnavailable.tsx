import { AppButton } from '../layout/AppButton';
import { AppText } from '../layout/AppText';
import { t } from '../i18n';

/** This state contains no summary text, citations or inferred clinical explanation. */
export function SavedSummaryUnavailable({
  disabled,
  onRegenerate,
}: {
  disabled: boolean;
  onRegenerate?: () => void;
}) {
  return (
    <>
      <AppText accessibilityRole="alert" testID="summary-period-unavailable">
        {t('summaryHistory.periodUnavailable')}
      </AppText>
      {onRegenerate ? (
        <AppButton
          title={t('summaryHistory.regenerate')}
          variant="secondary"
          disabled={disabled}
          onPress={onRegenerate}
          testID="summary-period-regenerate"
        />
      ) : null}
    </>
  );
}
