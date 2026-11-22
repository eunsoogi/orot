import {
  getGenericPassword,
  setGenericPassword,
  STORAGE_TYPE,
} from 'react-native-keychain';
import { createManualHistoryRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  captureOrdinaryConversationMemoryAdmission,
  openOrdinaryConversationMemoryOwner,
  readOrdinaryConversationMemorySettings,
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

test('a restored receipt cannot create notes until resetting and explicitly enabling this device', async () => {
  const sqlite = openSqliteTestDatabase(':memory:');
  const read = jest.mocked(getGenericPassword);
  const write = jest.mocked(setGenericPassword);
  write.mockClear();
  const device: { value: Awaited<ReturnType<typeof getGenericPassword>> } = {
    value: false,
  };
  read.mockImplementation(async () => device.value);
  write.mockImplementation(async (username, password) => {
    const result = { service, storage: STORAGE_TYPE.AES_GCM_NO_AUTH };
    device.value = { username, password, ...result };
    return result;
  });
  jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(sqlite.database);
  try {
    await runMigrations(sqlite.database);
    const history = createManualHistoryRepository(sqlite.database, {
      createId: () => 'conversation-local-memory:auto:synthetic-restored',
    });
    const prior = await history.create({
      kind: 'note',
      title: 'Synthetic saved preference',
      details: 'Synthetic previously saved note.',
      effectiveDate: { status: 'unknown' },
    });
    const owner = await openOrdinaryConversationMemoryOwner();
    expect(await owner.enable(settingsOwns)).toBe(true);
    const old = (await captureOrdinaryConversationMemoryAdmission())!;
    device.value = false;
    write.mockClear();
    expect(await readOrdinaryConversationMemorySettings(owner)).toBe(
      'unavailable',
    );
    expect(await captureOrdinaryConversationMemoryAdmission()).toBeUndefined();
    expect(old.isCurrent()).toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(await history.get(prior.id)).toMatchObject({
      details: prior.details,
    });
    expect(await owner.revoke()).toBe(true);
    expect(await readOrdinaryConversationMemorySettings(owner)).toBe('off');
    const inactive = await read({ service });
    if (!inactive) throw new Error('Missing revoked fixture metadata.');
    device.value = { ...inactive, password: 'null' };
    expect(await readOrdinaryConversationMemorySettings(owner)).toBe(
      'unavailable',
    );
    device.value = inactive;
    expect(await captureOrdinaryConversationMemoryAdmission()).toBeUndefined();
    expect(await owner.enable(settingsOwns)).toBe(true);
    const current = (await captureOrdinaryConversationMemoryAdmission())!;
    expect(current.deviceEpoch).not.toBe(old.deviceEpoch);
    expect(old.isCurrent()).toBe(false);
    expect(await history.list()).toEqual([prior]);
  } finally {
    sqlite.close();
  }
});
