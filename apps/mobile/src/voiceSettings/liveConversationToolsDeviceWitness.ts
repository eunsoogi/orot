import {
  ACCESSIBLE,
  getGenericPassword,
  resetGenericPassword,
  setGenericPassword,
} from 'react-native-keychain';
import type { DeviceBinding } from './liveResponsesSettingsBinding';
import {
  liveResponsesProviderId,
  liveResponsesRecipient,
} from './liveResponsesSettingsIdentity';
import {
  liveAggregateDeviceWitnessMatches,
  stageLiveAggregateDeviceWitness,
} from './liveAggregateDeviceWitness';

export const liveConversationToolsDevicePolicy =
  'selected-live-conversation-local-tools-v3';
const account = 'live-conversation-tools-policy';
const service = (generation: string) =>
  'com.orot.mobile.live-conversation-tools-policy.v3.' + generation;
const exact = (binding: DeviceBinding, voiceGeneration: string) => ({
  scope: liveConversationToolsDevicePolicy,
  providerId: liveResponsesProviderId,
  recipient: liveResponsesRecipient,
  backendModel: binding.backendModel,
  credentialEpoch: binding.credentialEpoch,
  generation: binding.generation,
  grantID: binding.grantID,
  voiceGeneration,
});

/** Permission remains contingent on the signed protected pair publication and
 * active authority. A staged marker never admits a native call by itself. */
export async function liveConversationToolsDeviceWitnessMatches(
  binding: DeviceBinding,
  voiceGeneration: string,
) {
  try {
    const row = await getGenericPassword({
      service: service(binding.generation),
    });
    if (!row || row.username !== account) return false;
    const value: unknown = JSON.parse(row.password);
    const expected = exact(binding, voiceGeneration);
    return Boolean(
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === Object.keys(expected).length &&
      Object.entries(expected).every(
        ([key, item]) =>
          Object.hasOwn(value, key) &&
          (value as Record<string, unknown>)[key] === item,
      ),
    );
  } catch {
    return false;
  }
}

/** Monotonic staged metadata for only this decision's unique generation.
 * A failed pair can clear this marker without rewriting its predecessor. */
export function createReviewedLivePairDevicePolicy(common: boolean) {
  let staged: { binding: DeviceBinding; voiceGeneration: string } | undefined;
  return {
    async stage(
      binding: DeviceBinding,
      voiceGeneration: string,
      current: () => boolean,
    ) {
      if (!current()) return false;
      await stageLiveAggregateDeviceWitness(binding);
      if (!current()) return false;
      if (common) {
        staged = { binding, voiceGeneration };
        const written = await setGenericPassword(
          account,
          JSON.stringify(exact(binding, voiceGeneration)),
          {
            service: service(binding.generation),
            accessible: ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
          },
        );
        if (!written || !current()) return false;
      }
      return this.matches(binding, voiceGeneration, current);
    },
    async matches(
      binding: DeviceBinding,
      voiceGeneration: string,
      current: () => boolean,
    ) {
      return (
        current() &&
        (await liveAggregateDeviceWitnessMatches(binding)) &&
        current() &&
        (!common ||
          (await liveConversationToolsDeviceWitnessMatches(
            binding,
            voiceGeneration,
          ))) &&
        current()
      );
    },
    async retire() {
      const value = staged;
      staged = undefined;
      if (
        !value ||
        !(await liveConversationToolsDeviceWitnessMatches(
          value.binding,
          value.voiceGeneration,
        ))
      )
        return;
      await resetGenericPassword({
        service: service(value.binding.generation),
      }).catch(() => false);
    },
  };
}
