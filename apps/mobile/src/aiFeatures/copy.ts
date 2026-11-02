import { t } from '../i18n';
import { healthReviewText } from '../i18n/healthReview';

/** Keeps route identifiers stable while localizing the primary action and its two follow-up groups. */
export function getAiFeatureCopy() {
  const conversation = {
    id: 'rag-conversation',
    title: t('aiFeatures.ragConversation.title'),
    description: t('aiFeatures.ragConversation.description'),
    action: t('aiFeatures.ragConversation.action'),
  };

  return {
    heading: t('aiFeatures.heading'),
    subtitle: t('aiFeatures.subtitle'),
    disclaimer: t('aiFeatures.disclaimer'),
    visitQuestionsUnavailable: t('aiFeatures.visitQuestions.unavailable'),
    conversation,
    preparation: {
      title: t('aiFeatures.preparation.title'),
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
      ],
    },
    review: {
      title: t('aiFeatures.review.title'),
      features: [
        {
          id: 'health-review',
          title: healthReviewText.entry,
          description: t('aiFeatures.healthReview.description'),
          action: healthReviewText.entry,
        },
        {
          id: 'external-evidence',
          title: t('aiFeatures.externalEvidence.title'),
          description: t('aiFeatures.externalEvidence.description'),
          action: t('aiFeatures.externalEvidence.action'),
        },
      ],
    },
  };
}
