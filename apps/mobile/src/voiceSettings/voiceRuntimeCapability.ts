import { NativeModules, Platform } from 'react-native';

/** Module presence allows the call entry, not a claim of network/account/audio readiness.
 * Inspecting exports must not create an audio owner, request a key or open a connection.
 */
export function hasRealtimeVoiceRuntime(): boolean {
  const module =
    Platform.OS === 'ios' ? NativeModules.VoiceRealtimeModule : null;
  return Boolean(
    module &&
    [
      'openRealtimeCall',
      'stopRealtimeCall',
      'interruptRealtimeOutput',
      'pauseRealtimeCall',
      'resumeRealtimeCall',
    ].every(name => typeof module[name] === 'function'),
  );
}

/** A compiled transport seam is not authorization or proof of API compatibility. */
export function hasLiveVoiceRuntime(): boolean {
  const module =
    Platform.OS === 'ios' ? NativeModules.VoiceRealtimeModule : null;
  return Boolean(
    module &&
    [
      'openLiveCall',
      'stopRealtimeCall',
      'interruptRealtimeOutput',
      'pauseRealtimeCall',
      'resumeRealtimeCall',
    ].every(name => typeof module[name] === 'function'),
  );
}
