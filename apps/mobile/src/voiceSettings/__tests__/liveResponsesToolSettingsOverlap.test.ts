import { SETTINGS_CONSENT_CATALOG_VERSION } from '../../agent/execution/settingsConsentCatalog';
import { loadLiveResponsesSettings } from '../liveResponsesSettings';
import {
  liveResponsesPermissions,
  liveResponsesProviderId,
  liveResponsesRecipient,
  liveResponsesSlot,
} from '../liveResponsesSettingsIdentity';

const mockPair = jest.fn();
const mockReview = jest.fn();
const mockAudio = jest.fn();
const mockAudioWitness = jest.fn();
const mockCredential = jest.fn();
const mockCapture = jest.fn();
const mockReadGrant = jest.fn();
const mockReadBinding = jest.fn();
const mockWrite = jest.fn();

jest.mock('../voiceSettingsStore', () => ({
  voiceSettingsStore: {
    loadCommittedVoicePair: (...args: unknown[]) => mockPair(...args),
    liveCredentials: (...args: unknown[]) => mockCredential(...args),
  },
}));
jest.mock('../voiceConsentIdentity', () => ({
  apiCredentialMutation: { capture: () => mockCapture() },
  voiceSelectionMutation: { capture: () => mockCapture() },
}));
jest.mock('../../agent/execution/consentRevision', () => ({
  consentRevision: () => 0,
  canReuseConsent: () => true,
}));
jest.mock('../../storage/settingsConsentAuthority', () => ({
  settingsConsentAuthority: (slot: string) =>
    slot === 'voice'
      ? { current: () => mockAudio(), witness: () => mockAudioWitness() }
      : { reviewState: () => mockReview(), revoke: () => mockWrite() },
}));
jest.mock('../../storage/settingsConsentRepository', () => ({
  settingsConsentRepository: async () => ({
    read: (slot: string) => mockReadGrant(slot),
    write: () => mockWrite(),
  }),
}));
jest.mock('react-native-keychain', () => ({
  getGenericPassword: () => mockReadBinding(),
  setGenericPassword: () => mockWrite(),
}));

const epoch = 'a'.repeat(64);
const voiceGeneration = 'b'.repeat(64);
const responsesGeneration = 'c'.repeat(64);
const backendModel = 'gpt-6-luna';

function hold<T>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>(resolve => {
    release = resolve;
  });
  return { promise, release };
}

/** Synthetic Settings ports keep device Keychain and protected SQL out of the
 * fixture. The exact loader controls scheduling, identity, and final admission. */
it.each([
  'alias',
  'startup',
  'authority-retired',
  'credential-retired',
  'generation-mismatch',
] as const)(
  're-proves the same Live Settings grant without serializing alias metadata: %s',
  async mode => {
    jest.resetAllMocks();
    let owner = true;
    let authority = true;
    const paired = {
      pair: {
        voiceGeneration,
        responsesGeneration:
          mode === 'generation-mismatch' ? 'd'.repeat(64) : responsesGeneration,
        credentialEpoch: epoch,
        backendModel,
      },
    };
    const review = {
      kind: 'active',
      generation: responsesGeneration,
      current: () => authority,
    } as const;
    const pair = hold<typeof paired>();
    const state = hold<typeof review>();
    const reviewEntered = hold<void>();
    mockPair.mockReturnValue(pair.promise);
    mockReview.mockImplementation(() => {
      reviewEntered.release(undefined);
      return state.promise;
    });
    mockCapture.mockReturnValue(() => owner);
    mockAudio.mockResolvedValue({ generation: voiceGeneration });
    mockAudioWitness.mockReturnValue(() => authority);
    mockCredential.mockResolvedValue({ credentialEpoch: epoch });
    mockReadGrant.mockResolvedValue({
      catalogVersion: SETTINGS_CONSENT_CATALOG_VERSION,
      identity: {
        providerId: liveResponsesProviderId,
        modelId: backendModel,
        recipient: liveResponsesRecipient,
        authorityGeneration: responsesGeneration,
        credentialEpoch: epoch,
      },
      permissions: liveResponsesPermissions,
    });
    const pending = loadLiveResponsesSettings(
      epoch,
      mode === 'startup' ? undefined : 'tool-reproof',
    );
    expect(mockPair).toHaveBeenCalledTimes(1);
    expect(mockReview).toHaveBeenCalledTimes(mode === 'startup' ? 0 : 1);
    expect(mockAudio).not.toHaveBeenCalled();
    expect(mockCredential).not.toHaveBeenCalled();
    expect(mockReadGrant).not.toHaveBeenCalled();

    if (mode === 'authority-retired') authority = false;
    if (mode === 'credential-retired') owner = false;
    pair.release(paired);
    await reviewEntered.promise;
    state.release(review);
    const result = await pending;
    expect(mockReadBinding).not.toHaveBeenCalled();
    expect(mockWrite).not.toHaveBeenCalled();
    if (mode !== 'alias' && mode !== 'startup') {
      expect(result).toEqual({ kind: 'unavailable' });
      expect(mockReadGrant).not.toHaveBeenCalled();
      if (mode !== 'generation-mismatch')
        expect(mockCredential).not.toHaveBeenCalled();
      return;
    }
    expect(result).toMatchObject({
      kind: 'active',
      credentialEpoch: epoch,
      nativeGrant: {
        backendModel,
        generation: responsesGeneration,
        grantID: responsesGeneration + '-model',
      },
    });
    expect(mockCredential).toHaveBeenCalledTimes(2);
    expect(mockReadGrant).toHaveBeenCalledTimes(1);
    expect(mockReadGrant).toHaveBeenCalledWith(liveResponsesSlot);
    if (result.kind !== 'active')
      throw new Error('Expected the exact synthetic receipt.');
    expect(result.current()).toBe(true);
    authority = false;
    expect(result.current()).toBe(false);
  },
);
