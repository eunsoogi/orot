import {
  getGenericPassword,
  resetGenericPassword,
  setGenericPassword,
} from 'react-native-keychain';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  createConsentAuthority,
  type ConsentAuthorityState,
} from '../../agent/execution/consentAuthority';
import { settingsConsentCredential } from '../../agent/execution/settingsConsentCredential';
import { createSettingsConsentStorage } from '../../storage/settingsConsentStorage';
import { settingsConsentRepository } from '../../storage/settingsConsentRepository';
import { settingsConsentAuthority } from '../../storage/settingsConsentAuthority';
import { readSettingsVoicePairSelection } from '../../storage/settingsVoicePairSelection';
import { liveVoiceModelId } from '../../agent/execution/liveVoiceSettingsIdentity';
import { initialPreferences } from '../liveVoicePreferences';
import { voiceSettingsStore } from '../voiceSettingsStore';

const epoch = 'c'.repeat(64);

export function createLiveConversationToolsSettingsFixture() {
  const db = openSqliteTestDatabase(':memory:');
  const store = createSettingsConsentStorage(db.database);
  jest.mocked(settingsConsentRepository).mockResolvedValue(store);
  let sequence = 0;
  const owner = () => {
    let state: ConsentAuthorityState | null = null;
    return createConsentAuthority(
      {
        read: async () => state,
        write: async value => {
          state = value;
        },
      },
      () => (++sequence).toString(16).padStart(64, '0'),
    );
  };
  const audio = owner(),
    responses = owner();
  jest.mocked(settingsConsentAuthority).mockImplementation(slot => {
    if (slot === 'voice') return audio;
    if (slot === 'voice-responses') return responses;
    throw new Error('Unexpected authority');
  });
  let revision = 1;
  jest
    .mocked(voiceSettingsStore.accountRevisionMatches)
    .mockImplementation(value => revision === value);
  jest.mocked(voiceSettingsStore.liveCredentials).mockResolvedValue({
    apiKey: 'synthetic',
    credentialEpoch: epoch,
    model: liveVoiceModelId,
  });
  jest.mocked(settingsConsentCredential).mockResolvedValue({
    epoch,
    isCurrent: () => revision === 1,
    subscribe: () => () => {},
  });
  jest
    .mocked(voiceSettingsStore.loadCommittedVoicePair)
    .mockImplementation(async () => {
      const saved = await readSettingsVoicePairSelection(db.database);
      return saved ? { pair: saved, preferences: initialPreferences } : null;
    });
  jest.mocked(voiceSettingsStore.stageVoicePair).mockResolvedValue(undefined);
  jest
    .mocked(voiceSettingsStore.activateVoicePair)
    .mockResolvedValue(undefined);
  jest
    .mocked(voiceSettingsStore.captureVoicePairPublication)
    .mockResolvedValue(() => revision === 1);
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
  jest
    .mocked(resetGenericPassword)
    .mockImplementation(async options =>
      keychain.delete(options?.service ?? ''),
    );
  return {
    keychain,
    db,
    store,
    responses,
    changeAccount: () => {
      revision += 1;
    },
  };
}
