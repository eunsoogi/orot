import { selectTestRoute } from '../e2e/testRoute';

describe('native test entry routing', () => {
  it('isolates app-hosted native tests from all UI probes', () => {
    expect(selectTestRoute({ OROT_TEST_HOST: 'YES' })).toBe('test-host');
    expect(
      selectTestRoute({
        OROT_TEST_HOST: true,
        OROT_TEST_PROFILE: 'speech',
      }),
    ).toBe('test-host');
  });

  it('selects only the explicitly supported profile routes', () => {
    expect(selectTestRoute({})).toBe('core');
    for (const profile of [
      'core',
      'speech',
      'openai-provider',
      'next-visit-questions',
    ]) {
      expect(selectTestRoute({ OROT_TEST_PROFILE: profile })).toBe(profile);
    }
  });

  it('rejects an unknown profile instead of silently running core tests', () => {
    expect(() => selectTestRoute({ OROT_TEST_PROFILE: 'unknown' })).toThrow(
      'Unsupported native test profile',
    );
  });

  it('selects explicit capability scenarios while the integration host remains isolated', () => {
    expect(
      selectTestRoute({ OROT_TEST_SCENARIO: 'ai-feature-visit-questions' }),
    ).toBe('ai-feature-visit-questions');
    expect(selectTestRoute({ OROT_TEST_SCENARIO: 'safe-area' })).toBe(
      'safe-area',
    );
    expect(selectTestRoute({ OROT_TEST_SCENARIO: 'backup' })).toBe('backup');
    expect(selectTestRoute({ OROT_TEST_SCENARIO: 'healthkit' })).toBe(
      'healthkit',
    );
    expect(
      selectTestRoute({ OROT_TEST_HOST: 'YES', OROT_TEST_SCENARIO: 'backup' }),
    ).toBe('test-host');
    expect(() => selectTestRoute({ OROT_TEST_SCENARIO: 'unknown' })).toThrow(
      'Unsupported test scenario',
    );
  });

  it('rejects removed diagnostic screens while retaining recording and paged fixture routes', () => {
    for (const scenario of ['apple-workflow', 'rag', 'hybrid-retrieval']) {
      expect(() => selectTestRoute({ OROT_TEST_SCENARIO: scenario })).toThrow(
        'Unsupported test scenario',
      );
    }
    for (const scenario of [
      'automatic-transcription',
      'metering',
      'paged-records',
    ]) {
      expect(selectTestRoute({ OROT_TEST_SCENARIO: scenario })).toBe(scenario);
    }
  });
});
