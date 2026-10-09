import { aiFeaturesKo } from './aiFeatures';
import { diseaseHypothesesKo } from './diseaseHypotheses';
import { externalMedicalEvidenceKo } from './externalMedicalEvidence';
import { ragConversationKo } from './ragConversation';
import { visitQuestionsKo } from './visitQuestions';

/** Keep feature strings modular while composing them once for the shared lookup table. */
export const aiFeatureCatalogsKo = {
  ...aiFeaturesKo,
  ...diseaseHypothesesKo,
  ...ragConversationKo,
  ...externalMedicalEvidenceKo,
  ...visitQuestionsKo,
} as const;
