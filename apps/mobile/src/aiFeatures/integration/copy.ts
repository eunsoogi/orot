import { t } from '../../i18n';

/** Keeps the integration controls short while feature descriptions use the shared catalog. */
export function getAiFeatureIntegrationCopy() {
  return {
    selectAi: t('provider.selection.title'),
    selectedAiNotice: t('provider.selection.introduction'),
    articleOpenError: t('aiFeatures.externalEvidence.articleOpenError'),
  };
}
