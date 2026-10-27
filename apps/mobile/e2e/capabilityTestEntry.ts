import type { TestRoute } from './testRoute';

/** A single test bundle retains each capability's original probe without rebuilding between scenarios. */
export function registerCapabilityTestEntry(route: TestRoute): boolean {
  switch (route) {
    case 'backup':
      require('./backupProbeEntry');
      break;
    case 'healthkit':
      require('./healthkitProbeEntry');
      break;
    case 'blood-pressure':
      require('./bloodPressureProbeEntry');
      break;
    case 'blood-pressure-visual':
      require('./bloodPressureVisualProbeEntry');
      break;
    case 'common-observations':
      require('./commonObservationsProbeEntry');
      break;
    case 'sleep-import':
      require('./sleepImportProbeEntry');
      break;
    case 'unified-import':
      require('./unifiedImportProbeEntry');
      break;
    case 'calendar':
      require('./calendarProbeEntry');
      break;
    case 'apple-foundation-models':
      require('./appleFoundationModelsProbeEntry');
      break;
    case 'automatic-transcription':
      require('./automaticTranscriptionProbeEntry');
      break;
    case 'metering':
      require('./microphoneMeteringProbeEntry');
      break;
    case 'paged-records':
      require('./pagedRecordsProbeEntry');
      break;
    case 'safe-area':
      require('./safeAreaProbeEntry');
      break;
    case 'ai-feature-visit-questions':
      require('./aiFeatureVisitQuestionsProbeEntry');
      break;
    case 'evidence-visual':
      require('./evidenceVisualProbeEntry');
      break;
    case 'conversation-visual':
      require('./conversationVisualProbeEntry');
      break;
    case 'summary-visual':
      require('./summaryVisualProbeEntry');
      break;
    case 'local-e5':
      require('./localE5EmbeddingProbeEntry');
      break;
    case 'local-query':
      require('./localRecordQueryProbeEntry');
      break;
    case 'provider-selection':
      require('./providerSelectionProbeEntry');
      break;
    case 'settings-accounts-layout':
      require('./settingsAccountsLayoutProbeEntry');
      break;
    case 'visit-questions':
      require('./visitQuestionsProbeEntry');
      break;
    case 'openai-tools':
      require('./openaiToolsProviderProbeEntry');
      break;
    default:
      return false;
  }
  return true;
}
