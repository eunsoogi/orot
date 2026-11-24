import type { SettingsVoicePairSelection } from '../storage/settingsVoicePairSelection';
import { readLivePreferences, type Preferences } from './liveVoicePreferences';

export type VoicePairDeviceCandidate = Readonly<{
  pair: SettingsVoicePairSelection;
  preferences: Preferences;
}>;

/** The device record must still point at this exact protected selection.
 * An explicit local save removes the pointer without reactivating other rows. */
export function referencesVoicePairSelection(
  value: unknown,
  pair: SettingsVoicePairSelection,
): boolean {
  if (!value || typeof value !== 'object') return false;
  const candidate: unknown = Reflect.get(value, 'pair');
  return (
    !!candidate &&
    typeof candidate === 'object' &&
    Object.keys(candidate).length === Object.keys(pair).length &&
    Object.entries(pair).every(
      ([key, expected]) => Reflect.get(candidate, key) === expected,
    )
  );
}

/** Match the actual protected selection row, never a merely staged Keychain choice. */
export function matchVoicePairDeviceCandidate(
  values: unknown,
  committed: SettingsVoicePairSelection | null,
  credentialEpoch: string | undefined,
): VoicePairDeviceCandidate | null {
  if (!committed) return null;
  if (!Array.isArray(values) || !values.length || values.length > 2)
    throw new Error('Voice pair settings are unavailable');
  const found = (values as readonly unknown[]).filter(value =>
    referencesVoicePairSelection(value, committed),
  );
  if (found.length !== 1 || committed.credentialEpoch !== credentialEpoch)
    throw new Error('Voice pair owner is unavailable');
  const preferences = readLivePreferences(
    Reflect.get(found[0] as object, 'preferences'),
  );
  if (preferences.kind !== 'ready')
    throw new Error('Voice pair preferences are unavailable');
  return { pair: committed, preferences: preferences.value };
}

/** Retain the one previously active candidate across a crash before publication.
 * Never accumulate settings history or copy a key into the protected configuration. */
export function stageVoicePairDeviceCandidate(
  previous: unknown,
  effective: SettingsVoicePairSelection | null,
  next: VoicePairDeviceCandidate,
  credentialEpoch: string,
): readonly VoicePairDeviceCandidate[] {
  if (
    next.pair.credentialEpoch !== credentialEpoch ||
    effective?.voiceGeneration === next.pair.voiceGeneration ||
    effective?.responsesGeneration === next.pair.responsesGeneration
  )
    throw new Error('Voice pair ownership changed');
  const old =
    effective?.credentialEpoch === credentialEpoch
      ? matchVoicePairDeviceCandidate(previous, effective, credentialEpoch)
      : null;
  return Object.freeze(old ? [old, next] : [next]);
}
