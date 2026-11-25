import { conversationMaterialsKo } from './conversationMaterialsKo';
import { realtimeToolConsentKo } from './realtimeToolConsentKo';
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
  ...realtimeToolConsentKo,
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
  ...conversationMaterialsKo,
  ...healthContextCopyKo,
  ...evidenceSourceKo,
  ...evidenceValuesKo,
  ...modelSettingsKo,
  ...nextVisitCopyKo,
  ...encounterReviewCopyKo,
  'settings.processWitness.read': '이 실행의 진단 상태 확인',
  'settings.processWitness.reading': '진단 상태 확인 중',
  'settings.processWitness.unavailable': '진단 상태를 확인할 수 없어요.',
  'settings.processWitness.launchConfirmed': '앱 시작 확인',
  'settings.processWitness.launchMissing': '앱 시작 확인 안 됨',
  'settings.processWitness.bridgeConfirmed': 'JS 연결 확인',
  'settings.processWitness.bridgeMissing': 'JS 연결 확인 안 됨',
} as const;
