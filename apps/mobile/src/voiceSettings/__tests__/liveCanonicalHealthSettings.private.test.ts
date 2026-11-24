import {
  createConsentAuthority,
  type ConsentAuthorityState,
} from '../../agent/execution/consentAuthority';
import { createSettingsConsentStorage } from '../../storage/settingsConsentStorage';
import { settingsConsentAuthority } from '../../storage/settingsConsentAuthority';
import { settingsConsentRepository } from '../../storage/settingsConsentRepository';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { loadLiveResponsesSettings } from '../liveResponsesSettings';
import { getGenericPassword, setGenericPassword } from 'react-native-keychain';
import { parseCanonicalHealthBinding } from '../liveCanonicalHealthBinding';
import {
  loadCanonicalLiveHealthSettings,
  readCanonicalLiveHealthChoice,
  readCanonicalLiveHealthStartup,
  revokeCanonicalLiveHealthSettings,
  saveCanonicalLiveHealthSettings,
} from '../liveCanonicalHealthSettings';

jest.mock('../../storage/settingsConsentAuthority', () => ({
  settingsConsentAuthority: jest.fn(),
}));
jest.mock('../../storage/settingsConsentRepository', () => ({
  settingsConsentRepository: jest.fn(),
}));
jest.mock('../liveResponsesSettings', () => ({
  loadLiveResponsesSettings: jest.fn(),
}));
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device' },
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
}));

test('distinct explicit v2 grant does not inherit the old aggregate and fails closed on revoked or replaced ownership', async () => {
  const lane = openSqliteTestDatabase(':memory:');
  try {
    let state: ConsentAuthorityState | undefined;
    let binding: string | undefined;
    let ordinal = 0;
    const authority = createConsentAuthority(
      {
        read: async () => state,
        write: async (next) => {
          state = next;
        },
      },
      () => String(++ordinal).padStart(64, '0'),
    );
    const store = createSettingsConsentStorage(lane.database);
    jest.mocked(settingsConsentAuthority).mockReturnValue(authority);
    jest.mocked(settingsConsentRepository).mockResolvedValue(store);
    jest.mocked(getGenericPassword).mockImplementation(async () =>
      binding
        ? ({
            username: 'live-health-context',
            password: binding,
            storage: 'fixture',
            service: 'fixture',
          } as never)
        : false,
    );
    jest.mocked(setGenericPassword).mockImplementation(async (_account, bytes) => {
      binding = bytes;
      return { service: 'fixture', storage: 'fixture' } as never;
    });
    const owner = { active: true };
    const old = 'a'.repeat(64);
    const baseline = (generation = old) => ({
      kind: 'active' as const,
      credentialEpoch: 'b'.repeat(64),
      nativeGrant: {
        backendModel: 'gpt-6-sol' as const,
        generation,
        grantID: generation + '-model',
      },
      current: () => owner.active,
      subscribe: () => () => {},
    });
    jest.mocked(loadLiveResponsesSettings).mockImplementation(async () => baseline());
    await expect(readCanonicalLiveHealthStartup(baseline())).resolves.toMatchObject({
      kind: 'off',
    });
    binding = '{';
    await expect(readCanonicalLiveHealthStartup(baseline())).resolves.toEqual({
      kind: 'unavailable',
    });
    binding = undefined;
    // Damaged SQLite grant rows are not a saved Off decision even without a Keychain binding.
    const orphanSlot = 'voice-responses-health-context';
    const insertOrphan = (id: string) =>
      lane.database.execute(
        `INSERT INTO settings_inference_grants
       (activation_id, slot, domain, state, grant_json) VALUES (?, ?, 'model', 'active', ?)`,
        [id, orphanSlot, '{'],
      );
    await insertOrphan('orphan-one');
    await expect(store.readReviewGrant(orphanSlot, 'model')).resolves.toEqual({
      status: 'unreadable',
    });
    await expect(readCanonicalLiveHealthStartup(baseline())).resolves.toEqual({
      kind: 'unavailable',
    });
    // Simulate an older damaged store with duplicate active rows, not a production write path.
    await lane.database.execute('DROP INDEX settings_inference_active_slot');
    await insertOrphan('orphan-two');
    await expect(store.readReviewGrant(orphanSlot, 'model')).resolves.toEqual({
      status: 'unreadable',
    });
    await expect(readCanonicalLiveHealthStartup(baseline())).resolves.toEqual({
      kind: 'unavailable',
    });
    await lane.database.execute('DELETE FROM settings_inference_grants WHERE slot = ?', [
      orphanSlot,
    ]);
    await lane.database.execute(
      `CREATE UNIQUE INDEX settings_inference_active_slot ON settings_inference_grants(slot, domain)
       WHERE state = 'active'`,
    );
    const signal = new AbortController().signal;
    const confirm = jest.fn(async () => false);
    const input = { signal, current: () => true, confirm };
    await expect(loadCanonicalLiveHealthSettings()).resolves.toBeUndefined();
    await expect(saveCanonicalLiveHealthSettings(input)).resolves.toBe(false);
    expect(binding).toBeUndefined();
    confirm.mockResolvedValue(true);
    await expect(saveCanonicalLiveHealthSettings(input)).resolves.toBe(true);
    const receipt = await loadCanonicalLiveHealthSettings();
    expect(receipt?.binding).toMatchObject({
      version: 2,
      legacyGeneration: old,
    });
    expect(receipt?.current()).toBe(true);
    await expect(readCanonicalLiveHealthStartup(baseline())).resolves.toMatchObject({
      kind: 'active',
    });
    await expect(readCanonicalLiveHealthStartup(baseline('c'.repeat(64)))).resolves.toEqual({
      kind: 'unavailable',
    });
    await expect(readCanonicalLiveHealthChoice('gpt-6-sol')).resolves.toMatchObject({
      enabled: true,
    });
    expect(parseCanonicalHealthBinding({ ...receipt?.binding, version: 1 })).toBeUndefined();
    owner.active = false;
    expect(receipt?.current()).toBe(false);
    owner.active = true;
    jest.mocked(loadLiveResponsesSettings).mockImplementation(async () => baseline('c'.repeat(64)));
    await expect(loadCanonicalLiveHealthSettings()).resolves.toBeUndefined();
    jest.mocked(loadLiveResponsesSettings).mockImplementation(async () => baseline());
    await revokeCanonicalLiveHealthSettings();
    await expect(readCanonicalLiveHealthStartup(baseline())).resolves.toMatchObject({
      kind: 'off',
    });
    await expect(loadCanonicalLiveHealthSettings()).resolves.toBeUndefined();
  } finally {
    lane.close();
  }
});
