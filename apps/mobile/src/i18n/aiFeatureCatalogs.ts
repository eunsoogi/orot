import { dailyReportRecoveryKo } from './dailyReportRecovery';
import { conversationTemplateKo } from './conversationTemplateKo';
import { conversationPreviousOutputsKo } from './conversationPreviousOutputsKo';
import { dailyReportSleepKo } from './dailyReportSleepKo';
import { dailyReportAnalysisKo } from './dailyReportAnalysisKo';
import { dailyReportHistoryKo } from './dailyReportHistoryKo';
import { conversationDeliveryKo } from './conversationDeliveryKo';
import { conversationSteeringKo } from './conversationSteeringKo';
import { conversationInterruptionKo } from './conversationInterruptionKo';
import { dailyReportActionsKo } from './dailyReportActionsKo';
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
  ...dailyReportRecoveryKo,
  ...conversationTemplateKo,
  ...dailyReportSleepKo,
  ...dailyReportAnalysisKo,
  ...conversationInterruptionKo,
  ...conversationSteeringKo,
  ...conversationDeliveryKo,
  ...conversationPreviousOutputsKo,
  ...dailyReportActionsKo,
  ...dailyReportHistoryKo,
  ...aiActivityKo,
  ...aiFeaturesKo,
  ...diseaseHypothesesKo,
  ...ragConversationKo,
  ...externalMedicalEvidenceKo,
  ...visitQuestionsKo,
  ...visitQuestionRestorationKo,
  ...treatmentSafetyKo,
} as const;
