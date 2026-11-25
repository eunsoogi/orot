import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import type { LiveManagedHealthCall } from './liveResponsesHealthToolExecutor';
import type { CanonicalLiveHealthSelection } from './bindCanonicalLiveHealthRun';
import type { LiveResponsesGrantIdentity } from './nativeRealtimeVoice';

/** Carry only typed, current-call managed challenges across the Live event bridge. */
export function nativeLiveManagedTools() {
  const module =
    Platform.OS === 'ios' ? NativeModules.VoiceRealtimeModule : null;
  if (
    typeof module?.claimLiveResponsesResult !== 'function' ||
    typeof module?.retireLiveResponsesResult !== 'function' ||
    typeof module?.settleLiveResponsesToolCall !== 'function' ||
    typeof module?.revokeLiveResponsesGrant !== 'function'
  )
    return null;
  const events = new NativeEventEmitter(module);
  return {
    canonicalAvailable: module.supportsCanonicalHealthContextV2 === true,
    ...(typeof module.reviewCanonicalLiveCall === 'function' &&
    typeof module.retireCanonicalLiveReview === 'function'
      ? {
          async reviewCanonicalCall(
            id: string,
            companion: CanonicalLiveHealthSelection['binding'],
            grant: LiveResponsesGrantIdentity,
            signal: AbortSignal,
          ) {
            if (signal.aborted) return null;
            const cancel = () => {
              void Promise.resolve(module.retireCanonicalLiveReview(id)).catch(
                () => undefined,
              );
            };
            signal.addEventListener('abort', cancel, { once: true });
            let approved = false;
            try {
              const decision: unknown = await module.reviewCanonicalLiveCall(
                id,
                companion,
                grant,
              );
              approved = !signal.aborted && decision === true;
              return !signal.aborted && typeof decision === 'boolean'
                ? decision
                : null;
            } finally {
              if (!approved) signal.removeEventListener('abort', cancel);
            }
          },
        }
      : {}),
    holdDelivery(
      call: LiveManagedHealthCall,
      beforeDispatch: (retire: () => void) => (() => void) | undefined,
      signal: AbortSignal,
    ) {
      const retire = () => {
        if (
          module.retireLiveResponsesResult(call.callId, call.challengeId) !==
          true
        )
          throw new Error('Native result retirement unavailable');
      };
      if (signal.aborted) return;
      const unregister = beforeDispatch(retire);
      if (!unregister) return;
      let claimed = false;
      try {
        if (signal.aborted) return;
        claimed =
          module.claimLiveResponsesResult(call.callId, call.challengeId) ===
          true;
        if (!claimed) return;
      } finally {
        if (!claimed) unregister();
      }
      // Native claim is synchronous, but cancellation may occur during the
      // claim, before this listener exists. Never hand an aborted lease back.
      if (signal.aborted) {
        retire();
        unregister();
        return;
      }
      signal.addEventListener('abort', retire, { once: true });
      return () => {
        signal.removeEventListener('abort', retire);
        retire();
        unregister();
      };
    },
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
            ((value as LiveManagedHealthCall).name === 'orot_health_context' ||
              (module.supportsCanonicalHealthContextV2 === true &&
                (value as LiveManagedHealthCall).name ===
                  'local-health-context')) &&
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
