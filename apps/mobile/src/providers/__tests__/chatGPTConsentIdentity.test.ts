import { getGenericPassword, setGenericPassword } from 'react-native-keychain';
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device' },
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
}));
let persisted: string | null;
let identity: typeof import('../chatGPTConsentIdentity');
beforeEach(() => {
  persisted = null;
  jest.mocked(getGenericPassword).mockImplementation(async () =>
    persisted
      ? ({
          username: 'synthetic',
          password: persisted,
          service: 'synthetic',
          storage: 'synthetic',
        } as never)
      : false,
  );
  jest.mocked(setGenericPassword).mockImplementation(async (_name, value) => {
    persisted = value;
    return { service: 'synthetic', storage: 'synthetic' } as never;
  });
  jest.isolateModules(() => {
    identity = require('../chatGPTConsentIdentity');
  });
});

test('missing identity is not approval; successful sign-in changes the epoch and invalidates old live witnesses', async () => {
  expect(await identity.readChatGPTConsentCredential()).toBeNull();
  await identity.mutateChatGPTConsentCredential(async () => 'account', false);
  const first = (await identity.readChatGPTConsentCredential())!;
  expect(first.isCurrent()).toBe(true);
  const change = identity.mutateChatGPTConsentCredential(
    async () => 'account',
    false,
  );
  expect(first.isCurrent()).toBe(false);
  await change;
  expect((await identity.readChatGPTConsentCredential())?.epoch).not.toBe(
    first.epoch,
  );
});

test('native cancellation keeps a durable suspension instead of assuming unchanged credentials', async () => {
  await identity.mutateChatGPTConsentCredential(async () => 'account', false);
  await expect(
    identity.mutateChatGPTConsentCredential(async () => {
      throw new Error('cancelled');
    }, false),
  ).rejects.toThrow('cancelled');
  expect(await identity.readChatGPTConsentCredential()).toBeNull();
  expect(JSON.parse(persisted!).status).toBe('suspended');
});

test('failed initial tombstone prevents sign-in but cannot prevent explicit credential removal', async () => {
  jest.mocked(setGenericPassword).mockResolvedValue(false);
  const native = jest.fn(async () => 'removed');
  await expect(
    identity.mutateChatGPTConsentCredential(native, false),
  ).rejects.toThrow('could not be saved');
  expect(native).not.toHaveBeenCalled();
  await expect(
    identity.mutateChatGPTConsentCredential(native, true),
  ).resolves.toBe('removed');
  expect(native).toHaveBeenCalledTimes(1);
  expect(await identity.readChatGPTConsentCredential()).toBeNull();
});

test('a late native success after explicit cancellation cannot reactivate the credential epoch', async () => {
  let complete!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => {
    entered = resolve;
  });
  const operation = identity.mutateChatGPTConsentCredential(async () => {
    entered();
    await new Promise<void>(resolve => {
      complete = resolve;
    });
    return 'late-account';
  }, false);
  await started;
  identity.cancelPendingChatGPTConsentSignIn();
  complete();
  await expect(operation).rejects.toThrow('identity changed');
  expect(await identity.readChatGPTConsentCredential()).toBeNull();
  expect(JSON.parse(persisted!).status).toBe('suspended');
});

test('explicit legacy initialization permits only truly absent metadata and never upgrades a suspension', async () => {
  expect(await identity.readChatGPTConsentCredential()).toBeNull();
  expect(persisted).toBeNull();
  expect(
    await identity.initializeChatGPTConsentCredential(async () => true),
  ).toBe(true);
  const original = await identity.readChatGPTConsentCredential();
  expect(original).not.toBeNull();
  expect(
    await identity.initializeChatGPTConsentCredential(async () => true),
  ).toBe(false);
  expect((await identity.readChatGPTConsentCredential())?.epoch).toBe(
    original?.epoch,
  );
  await expect(
    identity.mutateChatGPTConsentCredential(async () => {
      throw new Error('cancelled');
    }, false),
  ).rejects.toThrow();
  expect(
    await identity.initializeChatGPTConsentCredential(async () => true),
  ).toBe(false);
  expect(await identity.readChatGPTConsentCredential()).toBeNull();
});

test('malformed durable metadata is not absent legacy state', async () => {
  persisted = '{invalid';
  expect(
    await identity.initializeChatGPTConsentCredential(async () => true),
  ).toBe(false);
  expect(await identity.readChatGPTConsentCredential()).toBeNull();
  expect(persisted).toBe('{invalid');
});
