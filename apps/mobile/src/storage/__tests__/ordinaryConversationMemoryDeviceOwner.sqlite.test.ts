import {
  getGenericPassword,
  setGenericPassword,
  STORAGE_TYPE,
} from 'react-native-keychain';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  captureOrdinaryConversationMemoryAdmission,
  openOrdinaryConversationMemoryOwner,
} from '../ordinaryConversationMemoryDeviceOwner';
import { openLocalAgentMemoryDatabase } from '../secureDatabase';

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only' },
  STORAGE_TYPE: { AES_GCM_NO_AUTH: 'KeystoreAESGCM_NoAuth' },
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
}));
jest.mock('../secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
}));

const service = 'com.orot.mobile.ordinary-conversation-memory-authority.v1';
const account = 'ordinary-conversation-memory-authority';
const settingsOwns = () => true;

test('requires the dedicated device-only owner besides the restored SQLite receipt', async () => {
  const sqlite = openSqliteTestDatabase(':memory:');
  const read = jest.mocked(getGenericPassword);
  const write = jest.mocked(setGenericPassword);
  const device: { value: Awaited<ReturnType<typeof getGenericPassword>> } = {
    value: false,
  };
  read.mockImplementation(async () => device.value);
  write.mockImplementation(async (username, password) => {
    // The mocked native return's storage enum is irrelevant to the owner.
    const result = { service, storage: STORAGE_TYPE.AES_GCM_NO_AUTH };
    device.value = { username, password, ...result };
    return result;
  });
  jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(sqlite.database);
  try {
    const owner = await openOrdinaryConversationMemoryOwner();
    const sameOwner = await openOrdinaryConversationMemoryOwner();
    expect(sameOwner).toBe(owner);
    await expect(owner.capture()).resolves.toBeUndefined();
    expect(write).not.toHaveBeenCalled();
    await expect(owner.enable(settingsOwns)).resolves.toBe(true);
    expect(read).toHaveBeenCalledWith({ service });
    expect(write.mock.calls).toEqual([
      [
        account,
        expect.stringMatching(/"status":"suspended"/),
        { service, accessible: 'device-only' },
      ],
      [
        account,
        expect.stringMatching(/"status":"active"/),
        { service, accessible: 'device-only' },
      ],
    ]);
    await expect(owner.revoke()).resolves.toBe(true);
    let release!: () => void;
    const blockedOwnerOpen = new Promise<void>(resolve => {
      release = resolve;
    }).then(() => sqlite.database);
    jest
      .mocked(openLocalAgentMemoryDatabase)
      .mockReturnValueOnce(blockedOwnerOpen);
    const olderAdmission = captureOrdinaryConversationMemoryAdmission();
    try {
      await expect(owner.enable(settingsOwns)).resolves.toBe(true);
    } finally {
      release();
    }
    await expect(olderAdmission).resolves.toBeUndefined();
    const writesAfterExplicitEnrollment = write.mock.calls.length;
    const original = (await captureOrdinaryConversationMemoryAdmission())!;
    expect(original.isCurrent()).toBe(true);

    const saved = device.value;
    if (!saved) throw new Error('Missing synthetic authority');
    device.value = { ...saved, username: 'another-owner' };
    await expect(owner.capture()).resolves.toBeUndefined();
    expect(original.isCurrent()).toBe(false);
    device.value = false;
    await expect(owner.capture()).resolves.toBeUndefined();
    expect(write).toHaveBeenCalledTimes(writesAfterExplicitEnrollment);

    device.value = saved;
    await expect(owner.capture()).resolves.toMatchObject({
      deviceEpoch: original.deviceEpoch,
    });
    expect(original.isCurrent()).toBe(false);
    const replacement = (await owner.capture())!;
    const revoke = owner.revoke();
    expect(replacement.isCurrent()).toBe(false);
    await expect(revoke).resolves.toBe(true);
    await expect(owner.capture()).resolves.toBeUndefined();
  } finally {
    sqlite.close();
  }
});
