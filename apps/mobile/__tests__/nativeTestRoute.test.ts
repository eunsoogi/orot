import { selectNativeTestRoute } from '../e2e/nativeTestRoute';

describe('native test entry routing', () => {
  it('isolates app-hosted native tests from all UI probes', () => {
    expect(selectNativeTestRoute({ OROT_NATIVE_TEST_HOST: 'YES' })).toBe(
      'test-host',
    );
    expect(
      selectNativeTestRoute({
        OROT_NATIVE_TEST_HOST: true,
        OROT_NATIVE_TEST_PROFILE: 'speech',
      }),
    ).toBe('test-host');
  });

  it('selects only the explicitly supported profile routes', () => {
    expect(selectNativeTestRoute({})).toBe('core');
    for (const profile of [
      'core',
      'speech',
      'openai-provider',
      'next-visit-questions',
    ]) {
      expect(selectNativeTestRoute({ OROT_NATIVE_TEST_PROFILE: profile })).toBe(
        profile,
      );
    }
  });

  it('rejects an unknown profile instead of silently running core tests', () => {
    expect(() =>
      selectNativeTestRoute({ OROT_NATIVE_TEST_PROFILE: 'unknown' }),
    ).toThrow('Unsupported native test profile');
  });
});
