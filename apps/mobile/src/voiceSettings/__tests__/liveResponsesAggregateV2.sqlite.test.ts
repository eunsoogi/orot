import { getGenericPassword, setGenericPassword } from 'react-native-keychain';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  createConsentAuthority,
  type ConsentAuthorityState,
} from '../../agent/execution/consentAuthority';
import {
  SETTINGS_CONSENT_CATALOG_VERSION,
  settingsPermissionsForFeature,
} from '../../agent/execution/settingsConsentCatalog';
import { settingsConsentAuthority } from '../../storage/settingsConsentAuthority';
import { settingsConsentRepository } from '../../storage/settingsConsentRepository';
import { createSettingsConsentStorage } from '../../storage/settingsConsentStorage';
import { voiceSettingsStore } from '../voiceSettingsStore';
import { binding, writeBinding } from '../liveResponsesSettingsBinding';
import {
  loadLiveResponsesSettings,
  saveLiveResponsesSettings,
} from '../liveResponsesSettings';
import {
  liveResponsesAggregateV2Permissions,
  liveResponsesPermissions,
  liveResponsesProviderId,
  liveResponsesRecipient,
} from '../liveResponsesSettingsIdentity';
import { reviewLiveResponsesAggregate } from '../reviewLiveResponsesAggregate';
import { captureLegacyVoicePairRollback } from '../captureLegacyVoicePairRollback';
import {
  liveVoiceModelId,
  liveVoiceProviderId,
  liveVoiceRecipient,
} from '../../agent/execution/liveVoiceSettingsIdentity';
jest.mock('../../storage/settingsConsentAuthority', () => ({
  settingsConsentAuthority: jest.fn(),
}));
jest.mock('../../storage/settingsConsentRepository', () => ({
  settingsConsentRepository: jest.fn(),
}));
jest.mock('../voiceSettingsStore', () => ({
  voiceSettingsStore: {
    liveCredentials: jest.fn(),
    loadCommittedVoicePair: jest.fn(),
  },
}));
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device' },
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
}));
const epoch = 'a'.repeat(64);
const old = 'b'.repeat(64);
const voice = 'c'.repeat(64);
function authority(generation: string) {
  let state: ConsentAuthorityState = {
    version: 1,
    status: 'active',
    generation,
  };
  let sequence = 0;
  return createConsentAuthority(
    {
      read: async () => state,
      write: async value => {
        state = value;
      },
    },
    () => (++sequence).toString(16).padStart(64, '0'),
  );
}
const base = {
  version: 1,
  catalogVersion: SETTINGS_CONSENT_CATALOG_VERSION,
} as const;
const identity = {
  modelId: 'gpt-6-sol',
  providerId: liveResponsesProviderId,
  recipient: liveResponsesRecipient,
  authorityGeneration: old,
  credentialEpoch: epoch,
};
test('old exact receipt never grants headless scope; fresh reviewed settings commit and revoke exact V2', async () => {
  const db = openSqliteTestDatabase(':memory:');
  const store = createSettingsConsentStorage(db.database);
  const audio = authority(voice),
    tools = authority(old);
  jest
    .mocked(settingsConsentAuthority)
    .mockImplementation(slot => (slot === 'voice' ? audio : tools));
  jest.mocked(settingsConsentRepository).mockResolvedValue(store);
  jest.mocked(voiceSettingsStore.liveCredentials).mockResolvedValue({
    model: liveVoiceModelId,
    apiKey: 'synthetic',
    credentialEpoch: epoch,
  });
  const keychain = new Map<string, { username: string; password: string }>();
  jest
    .mocked(getGenericPassword)
    .mockImplementation(
      async options => (keychain.get(options?.service ?? '') as never) || false,
    );
  jest
    .mocked(setGenericPassword)
    .mockImplementation(async (username, password, options) => {
      keychain.set(options?.service ?? '', { username, password });
      return { service: '', storage: 'synthetic' } as never;
    });
  try {
    await writeBinding(binding(old, epoch, 'gpt-6-sol'));
    await store.stage('voice-responses', old + '-model', {
      ...base,
      identity,
      permissions: liveResponsesPermissions,
    });
    await store.activate('voice-responses', old + '-model', () => true);
    const before = await loadLiveResponsesSettings();
    expect(before.kind).toBe('active');
    expect(before).not.toHaveProperty('aggregatePolicy');
    const signal = new AbortController().signal;
    let current = true;
    const request = {
      backend: 'gpt-6-sol' as const,
      signal,
      current: () => current,
    };
    const approved = jest.fn(async () => true);
    const save = (
      reviewedAggregate: NonNullable<
        Awaited<ReturnType<typeof reviewLiveResponsesAggregate>>
      >,
    ) =>
      saveLiveResponsesSettings({
        backendModel: request.backend,
        reviewedAggregate,
        signal,
        isCurrent: request.current,
        audioCurrent: request.current,
      });
    const originalKeychain = [...keychain];
    await expect(
      save(Object.freeze({ backend: request.backend })),
    ).rejects.toThrow('Fresh Live aggregate settings review required');
    expect(
      await reviewLiveResponsesAggregate({
        ...request,
        confirm: async () => false,
      }),
    ).toBeUndefined();
    const ended = await reviewLiveResponsesAggregate({
      ...request,
      confirm: approved,
    });
    current = false;
    await expect(save(ended!)).rejects.toThrow(
      'Fresh Live aggregate settings review required',
    );
    expect([...keychain]).toEqual(originalKeychain);
    expect((await store.read('voice-responses'))?.permissions).toEqual(
      liveResponsesPermissions,
    );
    current = true;
    const reviewed = await reviewLiveResponsesAggregate({
      ...request,
      confirm: approved,
    });
    expect(approved).toHaveBeenLastCalledWith(
      expect.objectContaining({
        modelId: 'gpt-6-sol',
        recipient: 'OpenAI Responses (Live)',
        information: expect.stringMatching(/3~31일.*별도 확인 없이/u),
      }),
      signal,
    );
    await save(reviewed!);
    await expect(save(reviewed!)).rejects.toThrow(
      'Fresh Live aggregate settings review required',
    );
    const active = await loadLiveResponsesSettings(epoch, 'tool-reproof');
    if (active.kind !== 'active')
      throw new Error('Expected current v2 settings.');
    expect(active.nativeGrant.scope).toBe(
      'selected-live-heart-rate-aggregate-v2',
    );
    const service =
      'com.orot.mobile.live-aggregate-policy.v2.' +
      active.nativeGrant.generation;
    keychain.delete(service);
    expect((await loadLiveResponsesSettings()).kind).toBe('unavailable');
    await tools.revoke();
    expect(active.current()).toBe(false);
  } finally {
    db.close();
  }
});
test.each([
  { permissions: liveResponsesPermissions },
  { permissions: liveResponsesAggregateV2Permissions },
])(
  'rollback accepts only the original exact protected scope, never replacing v1 or v2',
  async ({ permissions }) => {
    const db = openSqliteTestDatabase(':memory:');
    const store = createSettingsConsentStorage(db.database);
    try {
      await store.stage('voice', voice + '-model', {
        ...base,
        identity: {
          providerId: liveVoiceProviderId,
          modelId: liveVoiceModelId,
          recipient: liveVoiceRecipient,
          authorityGeneration: voice,
          credentialEpoch: epoch,
        },
        permissions: settingsPermissionsForFeature(
          'voice',
          liveVoiceProviderId,
        ),
      });
      await store.activate('voice', voice + '-model', () => true);
      const seed = async (
        grantPermissions: typeof permissions,
        token: string,
      ) => {
        await store.stage('voice-responses', token, {
          ...base,
          identity,
          permissions: grantPermissions,
        });
        await store.activate('voice-responses', token, () => true);
      };
      await seed(permissions, old + '-model');
      const rollback = await captureLegacyVoicePairRollback({
        epoch,
        unchangedAccount: () => true,
        readLegacyEpoch: async () => epoch,
        readGrant: store.read,
        readResponsesBinding: async () => binding(old, epoch, 'gpt-6-sol'),
      });
      expect(await rollback('voice-responses', old)).toBe(true);
      await seed(
        permissions === liveResponsesPermissions
          ? liveResponsesAggregateV2Permissions
          : liveResponsesPermissions,
        old + '-replacement',
      );
      expect(await rollback('voice-responses', old)).toBe(false);
    } finally {
      db.close();
    }
  },
);
