import {
  canReuseConsent,
  consentRevision,
} from '../agent/execution/consentRevision';
import { captureLegacyVoicePairRollback } from './captureLegacyVoicePairRollback';
import { readBinding } from './liveResponsesSettingsBinding';
import { settingsConsentCredential } from '../agent/execution/settingsConsentCredential';
import {
  SETTINGS_CONSENT_CATALOG_VERSION,
  settingsPermissionsForFeature,
} from '../agent/execution/settingsConsentCatalog';
import {
  liveVoiceProviderId,
  liveVoiceRecipient,
} from '../agent/execution/liveVoiceSettingsIdentity';
import { settingsConsentAuthority } from '../storage/settingsConsentAuthority';
import { settingsConsentRepository } from '../storage/settingsConsentRepository';
import { commitReviewedVoicePair } from './commitReviewedVoicePair';
import {
  isLiveResponsesBackend,
  liveResponsesPermissions,
  liveResponsesProviderId,
  liveResponsesRecipient,
} from './liveResponsesSettingsIdentity';
import {
  liveModel,
  readLivePreferences,
  type Preferences,
} from './liveVoicePreferences';
import { liveVoicePreferencesKeychain } from './liveVoicePreferencesKeychain';
import type { OpenAiVoicePair } from './reviewOpenAiVoicePair';
import { voiceSettingsStore } from './voiceSettingsStore';

/** Called only after explicit review of the two exact destinations. Existing
 * account ownership continues to gate both independently scoped grants. */
export async function saveReviewedOpenAiVoicePair(input: {
  pair: OpenAiVoicePair;
  preferences?: Preferences;
  signal: AbortSignal;
  current: () => boolean;
}) {
  const { pair, signal } = input;
  const authorizationRevision = consentRevision();
  const account = () =>
    !signal.aborted &&
    input.current() &&
    voiceSettingsStore.accountRevisionMatches(pair.accountRevision);
  if (
    !account() ||
    pair.speechModel !== liveModel ||
    !isLiveResponsesBackend(pair.backendModel)
  )
    throw new Error('Voice pair selection unavailable');
  const credential = await settingsConsentCredential(liveVoiceProviderId, true);
  const sameAccount = () =>
    voiceSettingsStore.accountRevisionMatches(pair.accountRevision) &&
    credential?.isCurrent() === true &&
    canReuseConsent() &&
    consentRevision() === authorizationRevision;
  const current = () => account() && sameAccount();
  if (!credential || !current())
    throw new Error('Voice pair credential unavailable');
  const existing = await voiceSettingsStore
    .loadCommittedVoicePair()
    .catch(() => null);
  const legacy =
    input.preferences || existing
      ? null
      : await liveVoicePreferencesKeychain.load();
  const preferences = readLivePreferences(
    input.preferences ??
      existing?.preferences ??
      (legacy?.kind === 'ready' ? legacy.preferences : undefined),
  );
  if (preferences.kind !== 'ready' || !current())
    throw new Error('Voice pair preferences unavailable');
  const store = await settingsConsentRepository();
  const legacyRollback = existing
    ? null
    : await captureLegacyVoicePairRollback({
        epoch: credential.epoch,
        unchangedAccount: sameAccount,
        readLegacyEpoch: voiceSettingsStore.legacyVoiceRollbackEpoch,
        readGrant: slot => store.read(slot),
        readResponsesBinding: readBinding,
      });
  const target = (slot: 'voice' | 'voice-responses') => {
    const audio = slot === 'voice';
    const providerId = audio ? liveVoiceProviderId : liveResponsesProviderId;
    return {
      slot,
      authority: settingsConsentAuthority(slot),
      grant: (generation: string) => ({
        version: 1 as const,
        catalogVersion: SETTINGS_CONSENT_CATALOG_VERSION,
        identity: {
          providerId,
          modelId: audio ? pair.speechModel : pair.backendModel,
          recipient: audio ? liveVoiceRecipient : liveResponsesRecipient,
          authorityGeneration: generation,
          credentialEpoch: credential.epoch,
        },
        permissions: audio
          ? settingsPermissionsForFeature('voice', liveVoiceProviderId)
          : liveResponsesPermissions,
      }),
    };
  };
  let presented: () => boolean = () => false;
  await commitReviewedVoicePair(
    [target('voice'), target('voice-responses')],
    {
      stageGrant: (slot, token, grant) => store.stage(slot, token, grant),
      cancelGrant: store.cancel,
      stagePair: async generations => {
        await voiceSettingsStore.stageVoicePair(
          {
            pair: {
              version: 1,
              credentialEpoch: credential.epoch,
              speechModel: pair.speechModel,
              backendModel: pair.backendModel,
              voiceGeneration: generations.voice,
              responsesGeneration: generations['voice-responses'],
            },
            preferences: preferences.value,
          },
          pair.accountRevision,
          current,
        );
        return current();
      },
      // Old raw/effective settings remain in place until the final commit.
      // Never restore an old authority after account ownership changed.
      isPriorPairCurrent: async (slot, generation) => {
        if (!sameAccount()) return false;
        if (!existing)
          return (await legacyRollback?.(slot, generation)) === true;
        const prior = await voiceSettingsStore
          .loadCommittedVoicePair()
          .catch(() => null);
        return (
          sameAccount() &&
          prior?.pair.credentialEpoch === existing.pair.credentialEpoch &&
          prior?.pair.voiceGeneration === existing.pair.voiceGeneration &&
          prior?.pair.responsesGeneration ===
            existing.pair.responsesGeneration &&
          generation ===
            (slot === 'voice'
              ? existing.pair.voiceGeneration
              : existing.pair.responsesGeneration)
        );
      },
      publishTogether: async (grants, generations, guards) => {
        const selection = {
          version: 1 as const,
          credentialEpoch: credential.epoch,
          speechModel: pair.speechModel,
          backendModel: pair.backendModel,
          voiceGeneration: generations.voice,
          responsesGeneration: generations['voice-responses'],
        };
        await store.activateJointScopes(
          grants.map(grant => ({ ...grant, domain: 'model' as const })),
          guards,
          true,
          selection,
        );
        await voiceSettingsStore.activateVoicePair(
          selection,
          pair.accountRevision,
          guards,
        );
        const witness = await voiceSettingsStore.captureVoicePairPublication(
          selection,
          pair.accountRevision,
        );
        presented = () => sameAccount() && witness?.() === true;
      },
    },
    current,
  );
  return presented;
}
