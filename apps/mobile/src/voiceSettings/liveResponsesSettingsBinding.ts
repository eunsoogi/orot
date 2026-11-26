import {
  ACCESSIBLE,
  getGenericPassword,
  setGenericPassword,
} from 'react-native-keychain';
import {
  isLiveResponsesBackend,
  type LiveResponsesBackend,
} from './liveResponsesSettingsIdentity';

export interface NativeLiveResponsesGrant {
  readonly backendModel: LiveResponsesBackend;
  readonly grantID: string;
  readonly generation: string;
  readonly scope?: 'selected-live-heart-rate-aggregate-v2';
}

export interface DeviceBinding extends NativeLiveResponsesGrant {
  readonly version: 1;
  readonly credentialEpoch: string;
}

const service = 'com.orot.mobile.live-responses-settings.v1';
const account = 'live-responses-settings';
const generationPattern = /^[a-f0-9]{64}$/;

export function binding(
  generation: string,
  credentialEpoch: string,
  backendModel: LiveResponsesBackend,
): DeviceBinding {
  return {
    version: 1,
    backendModel,
    grantID: `${generation}-model`,
    generation,
    credentialEpoch,
  };
}

export async function readBinding(): Promise<DeviceBinding | null> {
  const value = await getGenericPassword({ service });
  if (!value) return null;
  if (value.username !== account)
    throw new Error('Invalid Live Responses owner');
  const row = JSON.parse(value.password) as Partial<DeviceBinding> | null;
  if (
    !row ||
    Object.keys(row).sort().join(',') !==
      'backendModel,credentialEpoch,generation,grantID,version' ||
    row.version !== 1 ||
    !isLiveResponsesBackend(row.backendModel) ||
    typeof row.generation !== 'string' ||
    !generationPattern.test(row.generation) ||
    typeof row.credentialEpoch !== 'string' ||
    !generationPattern.test(row.credentialEpoch) ||
    row.grantID !== `${row.generation}-model`
  )
    throw new Error('Invalid Live Responses owner');
  return binding(row.generation, row.credentialEpoch, row.backendModel);
}

export const sameBinding = (left: DeviceBinding, right: DeviceBinding | null) =>
  left.generation === right?.generation &&
  left.credentialEpoch === right.credentialEpoch &&
  left.backendModel === right.backendModel;

/** Persist exact nonsecret model/account metadata while canonical SQL authority is suspended. */
export async function writeBinding(value: DeviceBinding): Promise<void> {
  const ok = await setGenericPassword(account, JSON.stringify(value), {
    service,
    accessible: ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  if (!ok) throw new Error('Live Responses binding unavailable');
}
