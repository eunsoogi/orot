import { t } from '../../i18n';

/** Describe which saved-question dependencies remain available after restoration. */
export function savedVisitQuestionNotice(input: {
  empty: boolean;
  hasChangedPeriod: boolean;
  hasUnknownGeneratedSource: boolean;
  hasGeneratedOnly: boolean;
  onlyClarifications: boolean;
  hasQuestionWithoutSourceSpan: boolean;
  hasPeriod: boolean;
  hasGeneratedSources: boolean;
}): string {
  const notice = input.empty
    ? ''
    : input.hasChangedPeriod && input.hasUnknownGeneratedSource
      ? t('visitRestore.changedAndUnknown')
      : input.hasChangedPeriod
        ? t('visitRestore.changed')
        : input.hasUnknownGeneratedSource
          ? input.hasGeneratedOnly
            ? t('visitRestore.unknownGeneratedOnly')
            : t('visitRestore.unknownGenerated')
          : input.hasGeneratedOnly
            ? t('visitRestore.generatedOnly')
            : input.onlyClarifications
              ? t('visitRestore.clarificationsOnly')
              : input.hasQuestionWithoutSourceSpan
                ? t('visitRestore.missingSpan')
                : input.hasPeriod
                  ? t('visitRestore.periodRestored')
                  : t('visitRestore.missingVersions');
  // Direct public-web citations are not saved on questions; generated parents can retain separate research.
  return input.empty || input.hasGeneratedSources
    ? notice
    : t('visitRestore.webNotSaved', { notice });
}
