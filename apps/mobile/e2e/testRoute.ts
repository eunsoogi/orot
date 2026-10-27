export const capabilityScenarios = [
  'health-review',
  'backup',
  'healthkit',
  'blood-pressure',
  'blood-pressure-visual',
  'common-observations',
  'sleep-import',
  'unified-import',
  'calendar',
  'apple-foundation-models',
  'automatic-transcription',
  'metering',
  'paged-records',
  'safe-area',
  'ai-feature-visit-questions',
  'evidence-visual',
  'conversation-visual',
  'summary-visual',
  'local-e5',
  'local-query',
  'provider-selection',
  'settings-accounts-layout',
  'settings-provider-layout',
  'visit-questions',
  'openai-tools',
] as const;

export type TestRoute =
  | 'test-host'
  | 'core'
  | 'speech'
  | 'openai-provider'
  | 'next-visit-questions'
  | 'manual-history-recovery'
  | (typeof capabilityScenarios)[number];

/** Keep native service tests isolated from UI probe startup and reject unknown test profiles. */
export function selectTestRoute(settings: Record<string, unknown>): TestRoute {
  if (settings.OROT_TEST_HOST === 'YES' || settings.OROT_TEST_HOST === true) {
    return 'test-host';
  }
  const scenario = settings.OROT_TEST_SCENARIO;
  if (scenario !== undefined) {
    if (scenario === 'manual-history-recovery') return scenario;
    if (capabilityScenarios.some(candidate => candidate === scenario))
      return scenario as (typeof capabilityScenarios)[number];
    throw new Error('Unsupported test scenario');
  }
  const profile = settings.OROT_TEST_PROFILE;
  if (profile === undefined || profile === 'core') return 'core';
  if (
    profile === 'speech' ||
    profile === 'openai-provider' ||
    profile === 'next-visit-questions'
  ) {
    return profile;
  }
  throw new Error('Unsupported iOS test profile');
}
