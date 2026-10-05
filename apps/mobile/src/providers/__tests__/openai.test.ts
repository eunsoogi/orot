const baseAccount = {
  issuedClientID: 'oaiapp_synthetic_account_1',
  requiresSignIn: false,
  hasDirectPlanAccess: true,
};

function loadOpenAIProvider(nativeProviderModule: Record<string, unknown>) {
  jest.resetModules();
  const reactNative = require('react-native') as typeof import('react-native');
  Object.assign(reactNative.NativeModules, {
    OpenAIProviderModule: nativeProviderModule,
  });
  return require('../openai') as typeof import('../openai');
}

function makeNativeProviderModule(overrides: Record<string, unknown> = {}) {
  return {
    addListener: jest.fn(),
    removeListeners: jest.fn(),
    listAccounts: jest.fn(async () => [baseAccount]),
    signIn: jest.fn(async () => baseAccount),
    cancelSignIn: jest.fn(),
    signOut: jest.fn(async () => 'revoked'),
    listModels: jest.fn(async () => []),
    startResponse: jest.fn(),
    cancelResponse: jest.fn(),
    ...overrides,
  };
}

describe('OpenAI native account bridge', () => {
  it('accepts only the credential-free account summary fields', async () => {
    const native = makeNativeProviderModule();
    const openai = loadOpenAIProvider(native);

    await expect(openai.listOpenAIAccounts()).resolves.toEqual([baseAccount]);
    expect(native.listAccounts).toHaveBeenCalledTimes(1);
  });

  it('rejects native account summaries that include credentials', async () => {
    const native = makeNativeProviderModule({
      listAccounts: jest.fn(async () => [
        { ...baseAccount, accessToken: 'must-not-cross-the-bridge' },
      ]),
    });
    const openai = loadOpenAIProvider(native);

    await expect(openai.listOpenAIAccounts()).rejects.toMatchObject({
      code: 'INVALID_CHATGPT_ACCOUNT_SUMMARY',
    });
  });

  it('returns only a validated summary and supports cancellation/sign-out', async () => {
    const native = makeNativeProviderModule();
    const openai = loadOpenAIProvider(native);

    await expect(openai.signInToOpenAI()).resolves.toEqual(baseAccount);
    expect(native.signIn).toHaveBeenCalledWith(null);
    openai.cancelOpenAISignIn();
    expect(native.cancelSignIn).toHaveBeenCalledTimes(1);
    await expect(
      openai.signOutFromOpenAI(baseAccount.issuedClientID),
    ).resolves.toBe('revoked');
  });
});
