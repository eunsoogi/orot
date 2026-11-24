import { NativeModules, Platform } from 'react-native';
import { consentFixtureIdentity } from './settingsConsentNativeStore';

export type CanonicalQueueScenario = 'allow' | 'deny' | 'replace';

/** Fixed OROT_TESTS simulator command. The ABI has no content, credentials,
 * raw event or bound-grant arguments, and returns only synthetic counters. */
export async function runCanonicalSettingsQueueProbe(
  identifier: string,
  scenario: CanonicalQueueScenario,
): Promise<boolean> {
  const namespace = consentFixtureIdentity(identifier);
  if (Platform.OS !== 'ios') return false;
  const native = NativeModules.VoiceRealtimeModule;
  if (typeof native?.settingsConsentCanonicalQueueProbe !== 'function')
    return false;
  const value: unknown = await native.settingsConsentCanonicalQueueProbe(
    namespace,
    scenario,
  );
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  if (
    result.synthetic !== true ||
    result.timedOut !== false ||
    result.challenges !== 1 ||
    result.successorFrames !== 0
  )
    return false;
  if (scenario === 'allow')
    return (
      result.acknowledged === true &&
      result.frames === 2 &&
      result.exactOutput === true &&
      result.continuation === true
    );
  if (scenario === 'replace')
    return (
      result.acknowledged === false &&
      result.frames === 1 &&
      result.exactOutput === true &&
      result.continuation === false
    );
  return (
    result.acknowledged === false &&
    result.frames === 0 &&
    result.exactOutput === false &&
    result.continuation === false
  );
}
