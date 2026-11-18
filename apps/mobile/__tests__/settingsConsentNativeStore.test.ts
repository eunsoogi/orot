import { openSettingsConsentNativeStore } from '../e2e/settingsConsentNativeStore';
import { open, isSQLCipher } from '@op-engineering/op-sqlite';
import {
  STORAGE_TYPE,
  getGenericPassword,
  setGenericPassword,
  resetGenericPassword,
} from 'react-native-keychain';

jest.mock('@op-engineering/op-sqlite', () => ({
  IOS_LIBRARY_PATH: 'synthetic-library',
  isSQLCipher: jest.fn(() => true),
  open: jest.fn(() => ({ close: jest.fn(), delete: jest.fn() })),
}));
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only' },
  STORAGE_TYPE: { AES_GCM: 'AES_GCM' },
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
}));
const id = 'test-settings-consent-12345678-1234-1234-1234-123456789abc';
const values = new Map<string, string>();
beforeEach(() => {
  jest.clearAllMocks();
  values.clear();
  jest.mocked(isSQLCipher).mockReturnValue(true);
  jest.mocked(getGenericPassword).mockImplementation(async options => {
    const value = values.get(options!.service!);
    return value
      ? {
          username: 'synthetic',
          password: value,
          service: options!.service!,
          storage: STORAGE_TYPE.AES_GCM,
        }
      : false;
  });
  jest
    .mocked(setGenericPassword)
    .mockImplementation(async (_user, password, options) => {
      values.set(options!.service!, password);
      return { service: options!.service!, storage: STORAGE_TYPE.AES_GCM };
    });
  jest.mocked(resetGenericPassword).mockResolvedValue(true);
});

test.each(['', 'orot', '../orot.db', 'test-settings-consent-not-a-uuid'])(
  'invalid namespace %s touches no native storage',
  async value => {
    await expect(openSettingsConsentNativeStore(value, true)).rejects.toThrow();
    expect(getGenericPassword).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  },
);
test('native resource names and cleanup remain within the exact synthetic UUID', async () => {
  const created = await openSettingsConsentNativeStore(id, true);
  expect(open).toHaveBeenCalledWith(
    expect.objectContaining({
      name: `${id}.db`,
      encryptionKey: expect.stringMatching(/^[0-9a-f]{64}$/),
    }),
  );
  await created
    .selection('conversation')
    .save({ providerId: 'synthetic', modelId: 'synthetic' });
  created.close();
  const reopened = await openSettingsConsentNativeStore(id, false);
  expect(await reopened.selection('conversation').load()).toEqual({
    providerId: 'synthetic',
    modelId: 'synthetic',
  });
  expect(jest.mocked(open).mock.calls[0][0]).toEqual(
    jest.mocked(open).mock.calls[1][0],
  );
  await reopened.remove();
  for (const [options] of jest.mocked(resetGenericPassword).mock.calls)
    expect(options?.service).toMatch(
      new RegExp(`^com\\.orot\\.test\\.${id}\\.`),
    );
  expect(resetGenericPassword).toHaveBeenCalledTimes(7);
  expect(jest.mocked(open).mock.results[1].value.delete).toHaveBeenCalledTimes(
    1,
  );
});
test('missing, repeated creation and non-SQLCipher states fail without opening a database', async () => {
  await expect(openSettingsConsentNativeStore(id, false)).rejects.toThrow();
  expect(open).not.toHaveBeenCalled();
  values.set(
    `com.orot.test.${id}.database-key`,
    JSON.stringify('a'.repeat(64)),
  );
  await expect(openSettingsConsentNativeStore(id, true)).rejects.toThrow();
  expect(open).not.toHaveBeenCalled();
  jest.mocked(isSQLCipher).mockReturnValue(false);
  await expect(openSettingsConsentNativeStore(id, false)).rejects.toThrow();
  expect(open).not.toHaveBeenCalled();
});
