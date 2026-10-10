import { t } from '../i18n';

/** Keeps route identifiers stable while resolving each entry label from the active catalog. */
export function getAiFeatureCopy() {
  return {
    heading: t('aiFeatures.heading'),
    visitQuestionsUnavailable: t('aiFeatures.visitQuestions.unavailable'),
    features: [
      {
        id: 'visit-questions',
        title: t('aiFeatures.visitQuestions.title'),
        description: t('aiFeatures.visitQuestions.description'),
        action: t('aiFeatures.visitQuestions.action'),
      },
      {
        id: 'disease-hypotheses',
        title: t('aiFeatures.diseaseHypotheses.title'),
        description: t('aiFeatures.diseaseHypotheses.description'),
        action: t('aiFeatures.diseaseHypotheses.action'),
      },
      {
        id: 'rag-conversation',
        title: t('aiFeatures.ragConversation.title'),
        description: t('aiFeatures.ragConversation.description'),
        action: t('aiFeatures.ragConversation.action'),
      },
      {
        id: 'external-evidence',
        title: t('aiFeatures.externalEvidence.title'),
        description: t('aiFeatures.externalEvidence.description'),
        action: t('aiFeatures.externalEvidence.action'),
      },
    ],
  };
}
