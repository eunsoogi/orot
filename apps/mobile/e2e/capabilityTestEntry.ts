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
    case 'apple-workflow':
      require('./issue189AppleWorkflowProbeEntry');
      break;
    case 'automatic-transcription':
      require('./issue189AutomaticTranscriptionProbeEntry');
      break;
    case 'metering':
      require('./issue189MeteringProbeEntry');
      break;
    case 'rag':
      require('./issue189RagProbeEntry');
      break;
    case 'paged-records':
      require('./issue189UiProbeEntry');
      break;
    case 'hybrid-retrieval':
      require('./issue25HybridRetrievalProbeEntry');
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
