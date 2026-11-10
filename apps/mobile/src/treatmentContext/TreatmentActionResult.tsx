import { t } from '../i18n';
import { AppButton } from '../layout/AppButton';
import { AppText } from '../layout/AppText';

/** Show limits alongside verified record-bound text and keep actions explicit. */
export function TreatmentActionResult({
  answer,
  showLimits,
  sourceCount,
  onFollowUp,
  onDelete,
}: {
  readonly answer: string;
  readonly showLimits: boolean;
  readonly sourceCount?: number;
  readonly onFollowUp?: () => void;
  readonly onDelete?: () => void;
}) {
  return (
    <>
      <AppText accessibilityRole="alert">{answer}</AppText>
      {sourceCount ? (
        <AppText>
          {t('treatmentSafety.sourceCount', { count: sourceCount })}
        </AppText>
      ) : null}
      {showLimits ? (
        <AppText>{t('treatmentSafety.sourceLimits')}</AppText>
      ) : null}
      {onFollowUp ? (
        <AppButton title={t('treatmentSafety.followUp')} onPress={onFollowUp} />
      ) : null}
      {onDelete ? (
        <AppButton
          variant="destructive"
          title={t('treatmentSafety.deleteSaved')}
          onPress={onDelete}
        />
      ) : null}
    </>
  );
}
