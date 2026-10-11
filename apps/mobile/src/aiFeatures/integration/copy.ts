import { t } from '../../i18n';

/** Keeps the integration controls short while feature descriptions use the shared catalog. */
export function getAiFeatureIntegrationCopy() {
  return {
    articleOpenError: t('aiFeatures.externalEvidence.articleOpenError'),
    visitQuestionsSaveInProgressTitle: t(
      'aiFeatures.visitQuestions.saveInProgressTitle',
    ),
    visitQuestionsSaveInProgressMessage: t(
      'aiFeatures.visitQuestions.saveInProgressMessage',
    ),
    visitQuestionsSaveInProgressConfirm: t(
      'aiFeatures.visitQuestions.saveInProgressConfirm',
    ),
  };
}
