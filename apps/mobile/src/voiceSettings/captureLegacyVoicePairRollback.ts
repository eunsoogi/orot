import {
  SETTINGS_CONSENT_CATALOG_VERSION,
  settingsPermissionsForFeature,
} from '../agent/execution/settingsConsentCatalog';
import {
  liveVoiceModelId,
  liveVoiceProviderId,
  liveVoiceRecipient,
} from '../agent/execution/liveVoiceSettingsIdentity';
import type { SettingsConsentGrant } from '../agent/execution/settingsConsentGrant';
import { readBinding, sameBinding } from './liveResponsesSettingsBinding';
import {
  liveResponsesPermissionVersion,
  liveResponsesProviderId,
  liveResponsesRecipient,
} from './liveResponsesSettingsIdentity';

type Slot = 'voice' | 'voice-responses';

/** This is not dispatch admission: old authority may be safely suspended
 * during rollback. Only exact unchanged protected grants and binding matter. */
export async function captureLegacyVoicePairRollback(input: {
  readonly epoch: string;
  readonly unchangedAccount: () => boolean;
  readonly readLegacyEpoch: () => Promise<string | null>;
  readonly readGrant: (slot: Slot) => Promise<SettingsConsentGrant | null>;
  readonly readResponsesBinding: typeof readBinding;
}): Promise<(slot: Slot, generation: string) => Promise<boolean>> {
  const denied = async () => false;
  function valid(
    grant: SettingsConsentGrant | null,
    model: string,
    slot: Slot,
  ) {
    const audio = slot === 'voice';
    if (!grant || grant.catalogVersion !== SETTINGS_CONSENT_CATALOG_VERSION)
      return false;
    const identity = grant.identity;
    return (
      identity.providerId ===
        (audio ? liveVoiceProviderId : liveResponsesProviderId) &&
      identity.modelId === model &&
      identity.recipient ===
        (audio ? liveVoiceRecipient : liveResponsesRecipient) &&
      identity.credentialEpoch === input.epoch &&
      (audio
        ? JSON.stringify(grant.permissions) ===
          JSON.stringify(
            settingsPermissionsForFeature('voice', liveVoiceProviderId),
          )
        : liveResponsesPermissionVersion(grant.permissions) !== undefined)
    );
  }
  try {
    const epoch = await input.readLegacyEpoch();
    if (!input.unchangedAccount() || epoch !== input.epoch) return denied;
    const voice = await input.readGrant('voice');
    if (!valid(voice, liveVoiceModelId, 'voice')) return denied;
    const binding = await input.readResponsesBinding().catch(() => null);
    const tools = binding && (await input.readGrant('voice-responses'));
    const exactTools =
      binding &&
      binding.credentialEpoch === epoch &&
      tools?.identity.authorityGeneration === binding.generation &&
      valid(tools, binding.backendModel, 'voice-responses');
    if (!input.unchangedAccount()) return denied;
    const voiceBefore = JSON.stringify(voice);
    const toolsBefore = exactTools ? JSON.stringify(tools) : undefined;
    return async (slot, generation) => {
      if (
        !input.unchangedAccount() ||
        (await input.readLegacyEpoch()) !== epoch
      )
        return false;
      const currentVoice = await input.readGrant('voice');
      if (JSON.stringify(currentVoice) !== voiceBefore) return false;
      if (slot === 'voice-responses') {
        if (
          !toolsBefore ||
          !binding ||
          generation !== binding.generation ||
          !sameBinding(binding, await input.readResponsesBinding()) ||
          JSON.stringify(await input.readGrant(slot)) !== toolsBefore
        )
          return false;
      } else if (currentVoice?.identity.authorityGeneration !== generation)
        return false;
      return (
        input.unchangedAccount() &&
        (await input.readLegacyEpoch()) === epoch &&
        input.unchangedAccount()
      );
    };
  } catch {
    return denied;
  }
}
