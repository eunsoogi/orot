import {
  ACCESSIBLE,
  getGenericPassword,
  setGenericPassword,
} from 'react-native-keychain';
import {
  liveResponsesProviderId,
  liveResponsesRecipient,
} from './liveResponsesSettingsIdentity';
import {
  readBinding,
  sameBinding,
  writeBinding,
  type DeviceBinding,
} from './liveResponsesSettingsBinding';

export const liveAggregateDevicePolicy =
  'selected-live-heart-rate-aggregate-v2';
const account = 'live-aggregate-policy';
const service = (generation: string) =>
  'com.orot.mobile.live-aggregate-policy.v2.' + generation;
const exact = (binding: DeviceBinding) => ({
  scope: liveAggregateDevicePolicy,
  providerId: liveResponsesProviderId,
  recipient: liveResponsesRecipient,
  backendModel: binding.backendModel,
  credentialEpoch: binding.credentialEpoch,
  generation: binding.generation,
  grantID: binding.grantID,
});

/** Bind the new consent to this exact generation without overwriting a prior
 * generation that may still own rollback. The marker alone never grants use. */
export async function stageLiveAggregateDeviceWitness(binding: DeviceBinding) {
  const owner = exact(binding);
  if (
    !(await setGenericPassword(account, JSON.stringify(owner), {
      service: service(owner.generation),
      accessible: ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }))
  )
    throw new Error('Live aggregate scope witness unavailable');
}

export async function liveAggregateDeviceWitnessMatches(
  binding: DeviceBinding,
) {
  try {
    const stored = await getGenericPassword({
      service: service(binding.generation),
    });
    if (!stored || stored.username !== account) return false;
    const value: unknown = JSON.parse(stored.password);
    const fields = exact(binding);
    return Boolean(
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === Object.keys(fields).length &&
      Object.entries(fields).every(
        ([key, expected]) =>
          Object.hasOwn(value, key) &&
          (value as Record<string, unknown>)[key] === expected,
      ),
    );
  } catch {
    return false;
  }
}

export async function stageLiveAggregateSettingsBinding(
  binding: DeviceBinding,
) {
  await stageLiveAggregateDeviceWitness(binding);
  await writeBinding(binding);
}
export async function liveAggregateSettingsBindingMatches(
  binding: DeviceBinding,
) {
  return (
    sameBinding(binding, await readBinding()) &&
    (await liveAggregateDeviceWitnessMatches(binding))
  );
}
