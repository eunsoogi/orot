export type NativeTestRoute =
  'test-host' | 'core' | 'speech' | 'openai-provider' | 'next-visit-questions';

/** Keep native service tests isolated from UI probe startup and reject unknown test profiles. */
export function selectNativeTestRoute(
  settings: Record<string, unknown>,
): NativeTestRoute {
  if (
    settings.OROT_NATIVE_TEST_HOST === 'YES' ||
    settings.OROT_NATIVE_TEST_HOST === true
  ) {
    return 'test-host';
  }
  const profile = settings.OROT_NATIVE_TEST_PROFILE;
  if (profile === undefined || profile === 'core') return 'core';
  if (
    profile === 'speech' ||
    profile === 'openai-provider' ||
    profile === 'next-visit-questions'
  ) {
    return profile;
  }
  throw new Error('Unsupported native test profile');
}
