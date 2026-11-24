import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import type { LiveManagedHealthCall } from './liveResponsesHealthToolExecutor';
import type { LiveResponsesGrantIdentity } from './nativeRealtimeVoice';

/** Carry only typed, current-call managed challenges across the Live event bridge. */
export function nativeLiveManagedTools() {
  const module =
    Platform.OS === 'ios' ? NativeModules.VoiceRealtimeModule : null;
  if (
    typeof module?.settleLiveResponsesToolCall !== 'function' ||
    typeof module?.revokeLiveResponsesGrant !== 'function'
  )
    return null;
  const events = new NativeEventEmitter(module);
  return {
    settle: (callId: string, challengeId: string, result: string | null) =>
      module.settleLiveResponsesToolCall(
        callId,
        challengeId,
        result,
      ) as Promise<boolean>,
    revoke: (grant: LiveResponsesGrantIdentity) =>
      module.revokeLiveResponsesGrant(
        grant.grantID,
        grant.generation,
      ) as Promise<void>,
    subscribe(
      handle: (call: LiveManagedHealthCall) => void,
      cancel: (callId: string, challengeId: string) => void,
    ) {
      const valid = (value: unknown): value is string =>
        typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/u.test(value);
      const call = events.addListener(
        'VoiceRealtimeManagedToolCall',
        (value: unknown) => {
          if (
            value &&
            typeof value === 'object' &&
            [
              'callId',
              'sessionId',
              'challengeId',
              'toolCallId',
              'responseId',
              'delegationId',
            ].every(key => valid((value as Record<string, unknown>)[key])) &&
            (value as LiveManagedHealthCall).name === 'orot_health_context' &&
            typeof (value as LiveManagedHealthCall).args === 'string'
          )
            handle(value as LiveManagedHealthCall);
        },
      );
      const revoked = events.addListener(
        'VoiceRealtimeManagedToolCancelled',
        (value: unknown) => {
          const event = value as {
            callId?: string;
            challengeId?: string;
          } | null;
          if (valid(event?.callId) && valid(event?.challengeId))
            cancel(event.callId, event.challengeId);
        },
      );
      return () => {
        call.remove();
        revoked.remove();
      };
    },
  };
}
