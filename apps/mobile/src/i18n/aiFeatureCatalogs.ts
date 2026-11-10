import { aiFeaturesKo } from './aiFeatures';
import { aiActivityKo } from './aiActivity';
import { diseaseHypothesesKo } from './diseaseHypotheses';
import { externalMedicalEvidenceKo } from './externalMedicalEvidence';
import { ragConversationKo } from './ragConversation';
import { visitQuestionsKo } from './visitQuestions';
import { visitQuestionRestorationKo } from './visitQuestionRestoration';

/** Keep feature strings modular while composing them once for the shared lookup table. */
export const aiFeatureCatalogsKo = {
  ...aiActivityKo,
  ...aiFeaturesKo,
  ...diseaseHypothesesKo,
  ...ragConversationKo,
  ...externalMedicalEvidenceKo,
  ...visitQuestionsKo,
  ...visitQuestionRestorationKo,
} as const;
