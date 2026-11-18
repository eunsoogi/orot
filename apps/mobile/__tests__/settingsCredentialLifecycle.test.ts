import { getGenericPassword, setGenericPassword } from 'react-native-keychain';
import { openSqliteTestDatabase } from '../../../packages/storage/__tests__/sqliteTestDatabase';
import { createVoiceSettingsStore } from '../src/voiceSettings/createVoiceSettingsStore';
import { createSettingsConsentPersistenceFixture } from '../e2e/settingsConsentPersistenceFixture';
import type { ConsentAuthorityState } from '../src/agent/execution/consentAuthority';
import type { ProviderSelection } from '../src/providers/selection/types';
import type { SettingsConsentSlot } from '../src/storage/settingsConsentStorage';

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only' },
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
}));

// Real SQLite and production credential writer; Keychain is an explicit fake.
// Recreating owners here is not evidence of an actual OS process restart.
test('changed and removed persisted credentials deny old grants after owner recreation', async () => {
  const network = jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => {
      throw new Error('Synthetic fixture must not access transport');
    });
  const database = openSqliteTestDatabase(':memory:');
  const values = new Map<string, string>();
  jest.mocked(getGenericPassword).mockImplementation(async options => {
    const password = values.get(options!.service!);
    return password ? ({ password } as never) : false;
  });
  jest
    .mocked(setGenericPassword)
    .mockImplementation(async (_, value, options) => {
      values.set(options!.service!, value);
      return {} as never;
    });
  const authority = new Map<SettingsConsentSlot, ConsentAuthorityState>();
  const selection = new Map<SettingsConsentSlot, ProviderSelection>();
  const makeCredential = (service = 'synthetic-test-credential') =>
    createVoiceSettingsStore({
      service,
      beginSettingsMutation: () => () => {},
      beginCredentialMutation: () => () => {},
    });
  let credential = makeCredential();
  let serial = 0;
  const makeFixture = () =>
    createSettingsConsentPersistenceFixture({
      database: database.database,
      generation: () => (++serial).toString(16).padStart(64, '0'),
      credentialEpoch: async () => credential.consentAccountEpoch(false),
      authority: slot => ({
        read: async () => authority.get(slot) ?? null,
        write: async value => {
          authority.set(slot, value);
        },
      }),
      selection: slot => ({
        load: async () => selection.get(slot) ?? null,
        save: async value => {
          selection.set(slot, value);
        },
        clear: async () => {
          selection.delete(slot);
        },
      }),
    });
  try {
    await credential.setAccountKey('synthetic-a');
    const epoch = await credential.consentAccountEpoch(false);
    await makeFixture().approve('voice');
    credential = makeCredential();
    expect((await makeFixture().inspect()).observations.voice).toBe(
      'authorized',
    );
    await credential.setAccountKey('synthetic-b');
    expect(await credential.consentAccountEpoch(false)).not.toBe(epoch);
    credential = makeCredential();
    expect((await makeFixture().inspect()).observations.voice).toBe(
      'renewal_required',
    );
    await makeFixture().approve('voice');
    await credential.setAccountKey('');
    credential = makeCredential();
    expect(await credential.consentAccountEpoch(false)).toBeNull();
    expect((await makeFixture().inspect()).observations.voice).toBe(
      'renewal_required',
    );
    expect(
      await makeCredential('other-owner').consentAccountEpoch(false),
    ).toBeNull();
    const writes = jest.mocked(setGenericPassword).mock.calls;
    expect(
      writes.every(
        ([, , options]) => options?.service === 'synthetic-test-credential',
      ),
    ).toBe(true);
    expect(writes.map(([, value]) => JSON.parse(value).apiKey)).toEqual([
      'synthetic-a',
      'synthetic-b',
      '',
    ]);
  } finally {
    expect(network).not.toHaveBeenCalled();
    network.mockRestore();
    database.close();
  }
});
