import { IOS_TEST_COHORT_NAMES } from './ios-test-execution-plan.mjs';
import { maintainedNativeTestOwners } from './ios-test-impact-owners.mjs';

const all = IOS_TEST_COHORT_NAMES;
const ui = [
  'core-ui',
  'navigation',
  'recordings',
  'questions',
  'calendar',
  'provider',
  'health',
  'microphone',
  'selection',
];
const recording = [
  'core-integration',
  'persistence',
  'isolation',
  'backup',
  'recordings',
  'microphone',
  'speech',
];
// The maintained plan includes recording-export UI and root-tab integration assertions.
const recordingSource = [...recording, 'core-ui'];
const navigationSource = [...ui, 'core-integration'];
const questions = ['core-integration', 'questions', 'provider'];
const calendar = ['core-integration', 'calendar', 'provider', 'questions'];
const calendarUi = ['calendar', 'provider', 'questions'];
const health = ['core-integration', 'health', 'calendar', 'provider', 'questions'];
const healthUi = ['health', 'calendar', 'provider', 'questions'];
const provider = [
  'core-integration',
  'provider',
  'selection',
  'local-model',
  'questions',
  'calendar',
  'health',
];

function canonical(cohorts) {
  // Filtering the maintained plan expands a family and deduplicates overlapping selections in plan order.
  return all.filter((cohort) =>
    cohorts.some((selected) => cohort === selected || cohort.startsWith(selected + '-')),
  );
}

function impact(cohorts, reason, oauth = false) {
  return { cohorts: canonical(cohorts), oauth, reason };
}

function full(reason, oauth = true) {
  return impact(all, reason, oauth);
}

function e2eImpact(path) {
  const file = path.split('/').at(-1).toLowerCase();
  if (
    [
      'capabilitytestentry.tsx',
      'domaintestoperations.ts',
      'fixtureisolationtestoperation.ts',
    ].includes(file)
  )
    return full('shared-test-driver');
  if (file === 'appearancetestobservation.tsx') return impact(ui, 'shared-ui-observation');
  if (file.includes('calendar') || file.includes('appointment'))
    return impact(calendarUi, 'calendar-e2e-helper');
  if (file.includes('health') || file.includes('bloodpressure'))
    return impact(healthUi, 'health-e2e-helper');
  if (file.includes('recording') || file.includes('transcription') || file.includes('speech'))
    return impact(recording, 'recording-e2e-helper');
  if (file.includes('provider') || file.includes('auth'))
    return impact(provider, 'provider-e2e-helper', true);
  if (file.includes('question') || file.includes('visit'))
    return impact(questions, 'question-e2e-helper');
  if (file.includes('navigation') || file.includes('appearance') || file.includes('keyboard'))
    return impact(ui, 'shared-ui-observation');
  if (file.includes('backup'))
    return impact(['backup', 'persistence', 'isolation'], 'backup-e2e-helper');
  if (file.includes('localmodel') || file.includes('retrieval'))
    return impact(['core-integration', 'local-model', 'provider'], 'local-model-e2e-helper');
  return full('unknown-e2e-impact');
}

function sourceImpact(path) {
  const relative = path.slice('apps/mobile/src/'.length);
  const [area] = relative.split('/');
  switch (area) {
    case 'recording':
      return impact(recordingSource, 'recording-source');
    case 'transcription':
      return impact(
        ['core-integration', 'persistence', 'recordings', 'microphone', 'speech'],
        'transcription-source',
      );
    case 'healthEvidence':
    case 'healthkit':
      return impact(health, 'health-source');
    case 'appointments':
    case 'calendar':
    case 'medicalAppointments':
      return impact(calendar, 'calendar-source');
    case 'nextVisitQuestions':
      return impact(questions, 'question-source');
    case 'providers':
      return impact(provider, 'provider-source', true);
    case 'backup':
    case 'storage':
      return full('shared-persistence-source');
    case 'memory':
      return impact(['core-integration', 'local-model', 'provider'], 'memory-source');
    case 'rag':
    case 'ragConversation':
    case 'diseaseHypotheses':
    case 'externalMedicalEvidence':
      return impact(
        ['core-integration', 'provider', 'local-model', 'questions', 'calendar'],
        'evidence-workflow-source',
      );
    case 'agent':
    case 'aiFeatures':
      return impact([...provider, 'navigation', 'core-ui'], 'cross-feature-workflow-source');
    case 'navigation':
      return impact(navigationSource, 'shared-ui-source');
    case 'layout':
    case 'routes':
    case 'i18n':
    case 'assets':
      return impact(ui, 'shared-ui-source');
    default:
      return full('unknown-application-impact');
  }
}

function nativeTestImpact(path) {
  const file = path.split('/').at(-1);
  const lower = file.toLowerCase();
  const maintainedOwners = maintainedNativeTestOwners.get(path.toLowerCase());
  if (maintainedOwners) return impact(maintainedOwners, 'maintained-native-test-owner');

  if (path.includes('/OrotTestSupport/')) return full('shared-native-test-support');
  if (path.includes('/OrotUITests/')) {
    if (lower.includes('backuppersistence')) return impact(['backup'], 'backup-ui-test');
    if (lower.includes('localmodel')) return impact(['local-model'], 'local-model-test');
    if (lower.includes('speech') || lower.includes('transcription'))
      return impact(['recordings', 'microphone', 'speech'], 'speech-ui-test');
    if (lower.includes('microphone'))
      return impact(['microphone', 'recordings'], 'microphone-ui-test');
    if (lower.includes('health')) return impact(health, 'health-ui-test');
    if (lower.includes('calendar') || lower.includes('appointment'))
      return impact(calendar, 'calendar-ui-test');
    if (lower.includes('visitquestion') || lower.includes('nextvisit'))
      return impact(questions, 'question-ui-test');
    if (lower.includes('provider') || lower.includes('auth'))
      return impact(provider, 'provider-ui-test', true);
    if (lower.includes('unifiedimport'))
      return impact([...health, 'selection'], 'unified-import-ui-test');
    if (lower.includes('storage'))
      return impact(['persistence', 'isolation', 'backup'], 'storage-ui-test');
    if (
      lower.includes('recording') ||
      lower.includes('transcript') ||
      lower.includes('playback') ||
      lower.includes('export')
    )
      return impact(['recordings', 'persistence', 'backup'], 'recording-ui-test');
    if (
      lower.includes('navigation') ||
      lower.includes('safarea') ||
      lower.includes('keyboard') ||
      lower.includes('appearance')
    )
      return impact(ui, 'shared-ui-test');
    return full('unknown-native-ui-test');
  }

  if (path.includes('/OrotIntegrationTests/')) {
    if (lower.includes('localmodel') || lower.includes('locale5'))
      return impact(['core-integration', 'local-model'], 'local-model-integration-test');
    if (lower.includes('speech')) return impact(['speech'], 'speech-integration-test');
    if (lower.includes('health')) return impact(health, 'health-integration-test');
    if (lower.includes('appleworkflow'))
      return impact(['core-integration', ...calendar, 'health'], 'workflow-integration-test');
    if (lower.includes('provider') || lower.includes('rag') || lower.includes('applemodel'))
      return impact(provider, 'provider-integration-test');
    if (lower.includes('navigation')) return impact(ui, 'shared-ui-integration-test');
    if (lower.includes('recording')) return impact(recording, 'recording-integration-test');
    if (lower.includes('statepersistence') || lower.includes('fixtureisolation'))
      return impact(
        ['core-integration', 'persistence', 'isolation', 'backup'],
        'state-integration-test',
      );
    if (lower.includes('hermesdomain'))
      return impact(
        ['core-integration', 'local-model', 'provider', 'health', 'calendar', 'questions'],
        'cross-domain-integration-test',
      );
    return full('unknown-native-integration-test');
  }

  if (path.includes('/OrotMobile.xcodeproj/')) return full('native-project-configuration');
  if (path.includes('/OrotMobile/')) {
    if (/^(test|syntheticcalendar|testfixture|testcontrol|testoperation)/i.test(file))
      return full('shared-native-test-driver');
    if (/^(database|storage|sqlcipher|keychain|appdelegate)/i.test(file))
      return full('shared-native-runtime');
    if (/recording|transcript|playback|export/i.test(file))
      return impact(recording, 'recording-native-module');
    if (/speech|transcription/i.test(file))
      return impact(
        ['core-integration', 'recordings', 'microphone', 'speech'],
        'speech-native-module',
      );
    if (/healthkit|health|bloodpressure/i.test(file)) return impact(health, 'health-native-module');
    if (/eventkit|calendar|appointment/i.test(file))
      return impact(calendar, 'calendar-native-module');
    if (/provider|openai|applefoundationmodels|languageModel|rag/i.test(file))
      return impact(provider, 'provider-native-module', /oauth|auth|openai/i.test(file));
    if (/backup/i.test(file))
      return impact(
        ['core-integration', 'persistence', 'isolation', 'backup'],
        'backup-native-module',
      );
    if (/navigation|glass|layout/i.test(file)) return impact(ui, 'shared-ui-native-module');
  }
  return full('unknown-native-impact');
}

/** Maps a changed app path to complete hosted suites; shared or unclassified boundaries fail closed to all suites. */
export function iosTestImpactForPath(path) {
  if (typeof path !== 'string' || !path || /[\0\r\n]/.test(path))
    return full('invalid-application-path');
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '');
  if (normalized.startsWith('packages/'))
    return full('shared-package', normalized.startsWith('packages/provider-openai/'));
  if (normalized.startsWith('apps/mobile/e2e/')) return e2eImpact(normalized);
  if (normalized.startsWith('apps/mobile/src/')) return sourceImpact(normalized);
  if (normalized.startsWith('apps/mobile/ios/')) return nativeTestImpact(normalized);
  if (
    normalized.startsWith('apps/mobile/assets/') ||
    normalized.startsWith('apps/mobile/src/assets/')
  )
    return impact(ui, 'shared-ui-asset');
  if (normalized.startsWith('apps/mobile/')) return full('unknown-mobile-impact');
  return full('unknown-application-impact');
}
