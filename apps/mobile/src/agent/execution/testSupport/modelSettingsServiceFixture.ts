/** Complete inert service shape for view-only tests; no native account or catalog fallback. */
export function modelSettingsVoiceFixture() {
  return {
    load: jest.fn(async () => ({
      mode: 'local' as const,
      model: 'apple-system-speech',
      hasApiKey: false,
    })),
    save: jest.fn(async () => {}),
    accountStatus: jest.fn(async () => ({ connected: false, revision: 1 })),
    discoverModels: jest.fn(async () => ({ revision: 1, ids: [] as string[] })),
    subscribe: jest.fn(() => () => {}),
  };
}
export function modelSettingsSelectionFixture() {
  return {
    load: jest.fn(async () => null),
    save: jest.fn(async () => {}),
    clear: jest.fn(async () => {}),
  };
}
