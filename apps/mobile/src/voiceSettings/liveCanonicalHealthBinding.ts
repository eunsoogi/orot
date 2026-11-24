import {
  ACCESSIBLE,
  getGenericPassword,
  setGenericPassword,
} from 'react-native-keychain';
import {
  isLiveResponsesBackend,
  type LiveResponsesBackend,
} from './liveResponsesSettingsIdentity';
import type { NativeLiveResponsesGrant } from './liveResponsesSettingsBinding';

export const canonicalHealthSlot = 'voice-responses-health-context';
export const canonicalHealthPolicy = 'canonical-health-context-result-v2';
export const canonicalHealthBindingService =
  'com.orot.mobile.live-health-context.v2';
const account = 'live-health-context';
const digest = /^[0-9a-f]{64}$/u;

export interface CanonicalHealthBinding {
  readonly version: 2;
  readonly capability: typeof canonicalHealthPolicy;
  readonly grantID: string;
  readonly generation: string;
  readonly legacyGeneration: string;
  readonly credentialEpoch: string;
  readonly backendModel: LiveResponsesBackend;
}

export function canonicalHealthBinding(
  generation: string,
  baseline: NativeLiveResponsesGrant,
  credentialEpoch: string,
): CanonicalHealthBinding {
  return {
    version: 2,
    capability: canonicalHealthPolicy,
    grantID: generation + '-model',
    generation,
    legacyGeneration: baseline.generation,
    credentialEpoch,
    backendModel: baseline.backendModel,
  };
}

export function parseCanonicalHealthBinding(
  value: unknown,
): CanonicalHealthBinding | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const row = value as Record<string, unknown>;
  const validDigest = (item: unknown): item is string =>
    typeof item === 'string' && digest.test(item);
  if (
    Object.keys(row).sort().join(',') !==
      'backendModel,capability,credentialEpoch,generation,grantID,legacyGeneration,version' ||
    row.version !== 2 ||
    row.capability !== canonicalHealthPolicy ||
    !isLiveResponsesBackend(row.backendModel) ||
    !validDigest(row.generation) ||
    !validDigest(row.legacyGeneration) ||
    !validDigest(row.credentialEpoch) ||
    row.generation === row.legacyGeneration ||
    row.grantID !== row.generation + '-model'
  )
    return;
  return {
    version: 2,
    capability: canonicalHealthPolicy,
    generation: row.generation,
    grantID: row.grantID,
    legacyGeneration: row.legacyGeneration,
    credentialEpoch: row.credentialEpoch,
    backendModel: row.backendModel,
  } as CanonicalHealthBinding;
}

export async function readCanonicalHealthBinding(): Promise<
  CanonicalHealthBinding | undefined
> {
  const value = await getGenericPassword({
    service: canonicalHealthBindingService,
  });
  if (!value) return;
  if (value.username !== account)
    throw new Error('Invalid canonical Live health owner');
  const binding = parseCanonicalHealthBinding(JSON.parse(value.password));
  if (!binding) throw new Error('Invalid canonical Live health owner');
  return binding;
}

export async function writeCanonicalHealthBinding(
  value: CanonicalHealthBinding,
): Promise<void> {
  if (
    !parseCanonicalHealthBinding(value) ||
    !(await setGenericPassword(account, JSON.stringify(value), {
      service: canonicalHealthBindingService,
      accessible: ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }))
  )
    throw new Error('Canonical Live health owner is unavailable');
}
