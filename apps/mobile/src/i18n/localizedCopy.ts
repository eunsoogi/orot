import { calendarDisplayKo } from './calendarDisplayKo';
import { historyDisplayKo } from './historyDisplayKo';
import { dailySynthesisKo } from './dailySynthesisKo';
import { computedQuantityKo } from './computedQuantityKo';
import { computedTopicKo } from './computedTopicKo';
import { computedLimitsKo } from './computedLimitsKo';
import { healthSemanticKo } from './healthSemanticKo';
import { sourceDisplayKo } from './sourceDisplayKo';
import { legacySymptomKo } from './legacySymptomKo';
import { realtimeDisplayKo } from './realtimeDisplayKo';
import { visitQuestionDisplayKo } from './visitQuestionDisplayKo';
import { summaryEvidenceKo } from './summaryEvidenceKo';
import { summaryHistoryKo } from './summaryHistoryKo';
import { recordingExportKo } from './recordingExportKo';
import { dailyGuidanceKo } from './dailyGuidanceKo';
import { savedMemoryKo } from './savedMemoryKo';
import { healthContextCopyKo } from './healthContextCopyKo';
import { evidenceSourceKo } from './evidenceSourceKo';
import { evidenceValuesKo } from './evidenceValuesKo';
import { modelSettingsKo } from './modelSettings';
import { nextVisitCopyKo } from './nextVisitCopyKo';
import { encounterReviewCopyKo } from './encounterReviewCopyKo';

/** Incremental UI-copy migrations share one catalog entry point. */
export const localizedCopyKo = {
  ...calendarDisplayKo,
  ...historyDisplayKo,
  ...dailySynthesisKo,
  ...computedQuantityKo,
  ...computedTopicKo,
  ...computedLimitsKo,
  ...healthSemanticKo,
  ...sourceDisplayKo,
  ...legacySymptomKo,
  ...realtimeDisplayKo,
  ...visitQuestionDisplayKo,
  ...summaryEvidenceKo,
  ...summaryHistoryKo,
  ...recordingExportKo,
  ...dailyGuidanceKo,
  ...savedMemoryKo,
  ...healthContextCopyKo,
  ...evidenceSourceKo,
  ...evidenceValuesKo,
  ...modelSettingsKo,
  ...nextVisitCopyKo,
  ...encounterReviewCopyKo,
} as const;
