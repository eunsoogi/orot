import { t } from '../i18n';
import { AppButton } from '../layout/AppButton';
import { AppText } from '../layout/AppText';
import type { VerifiedTreatmentSource } from './treatmentSourceLinks';

/** Show limits alongside verified record-bound text and keep actions explicit. */
export function TreatmentActionResult({
  answer,
  showLimits,
  sources,
  general,
  onOpenSource,
  onFollowUp,
  onDelete,
}: {
  readonly answer: string;
  readonly showLimits: boolean;
  readonly sources?: readonly VerifiedTreatmentSource[];
  readonly general?: readonly string[];
  readonly onOpenSource?: (link: VerifiedTreatmentSource) => void;
  readonly onFollowUp?: () => void;
  readonly onDelete?: () => void;
}) {
  return (
    <>
      <AppText accessibilityRole="alert">{answer}</AppText>
      {onOpenSource
        ? sources?.map((link, index) => (
            <AppButton
              key={link.source.reference.evidenceId}
              variant="secondary"
              title={t('treatmentSafety.openSource', { index: index + 1 })}
              onPress={() => onOpenSource(link)}
            />
          ))
        : null}
      {general?.length ? (
        <>
          <AppText accessibilityRole="header">
            {t('treatmentSafety.generalEducation')}
          </AppText>
          {general.map(text => (
            <AppText key={text}>{text}</AppText>
          ))}
        </>
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
