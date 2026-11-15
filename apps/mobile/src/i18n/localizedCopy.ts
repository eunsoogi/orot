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
