import type { SettingsConsentGrant } from '../agent/execution/settingsConsentGrant';
import { SETTINGS_CONSENT_CATALOG_VERSION } from '../agent/execution/settingsConsentCatalog';
import {
  liveResponsesPermissionVersion,
  liveResponsesProviderId,
  liveResponsesRecipient,
} from './liveResponsesSettingsIdentity';
import type { DeviceBinding } from './liveResponsesSettingsBinding';
import { liveConversationToolsDeviceWitnessMatches } from './liveConversationToolsDeviceWitness';
import { liveAggregateDeviceWitnessMatches } from './liveAggregateDeviceWitness';

/** A shared-catalog grant exists only for the atomically published Voice pair.
 * Its aggregate portion preserves the existing native witness, not generic authority. */
export async function liveResponsesActivePolicy(
  grant: SettingsConsentGrant | null,
  identity: DeviceBinding,
  voiceGeneration: string | undefined,
) {
  if (
    !grant ||
    grant.catalogVersion !== SETTINGS_CONSENT_CATALOG_VERSION ||
    grant.identity.providerId !== liveResponsesProviderId ||
    grant.identity.modelId !== identity.backendModel ||
    grant.identity.recipient !== liveResponsesRecipient ||
    grant.identity.authorityGeneration !== identity.generation ||
    grant.identity.credentialEpoch !== identity.credentialEpoch
  )
    return;
  const policy = liveResponsesPermissionVersion(grant.permissions);
  if (
    !policy ||
    (policy === 'common-tools-v3' &&
      (!voiceGeneration ||
        !(await liveConversationToolsDeviceWitnessMatches(
          identity,
          voiceGeneration,
        )))) ||
    (policy !== 'interactive-v1' &&
      !(await liveAggregateDeviceWitnessMatches(identity)))
  )
    return;
  return policy;
}
