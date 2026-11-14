import { conversationInterruptionKo } from './conversationInterruptionKo';
import { aiFeaturesKo } from './aiFeatures';
import { aiActivityKo } from './aiActivity';
import { diseaseHypothesesKo } from './diseaseHypotheses';
import { externalMedicalEvidenceKo } from './externalMedicalEvidence';
import { ragConversationKo } from './ragConversation';
import { visitQuestionsKo } from './visitQuestions';
import { visitQuestionRestorationKo } from './visitQuestionRestoration';
import { treatmentSafetyKo } from './treatmentSafety';

/** Keep feature strings modular while composing them once for the shared lookup table. */
export const aiFeatureCatalogsKo = {
  ...conversationInterruptionKo,
  ...aiActivityKo,
  ...aiFeaturesKo,
  ...diseaseHypothesesKo,
  ...ragConversationKo,
  ...externalMedicalEvidenceKo,
  ...visitQuestionsKo,
  ...visitQuestionRestorationKo,
  ...treatmentSafetyKo,
} as const;
