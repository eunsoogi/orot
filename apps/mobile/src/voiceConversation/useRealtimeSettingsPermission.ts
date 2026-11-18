import { useEffect, useMemo, useRef } from 'react';
import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import { useInferenceConsent } from '../agent/execution/useInferenceConsent';

/** A continuing settings grant becomes a revocable, call-local audio lease. Native
 * microphone/foreground permission and actual source/action checks remain separate. */
export function useRealtimeSettingsPermission() {
  const { consent } = useInferenceConsent();
  const active = useRef<{
    controller: AbortController;
    request: OutboundProcessingRequest;
    stop: () => void;
  } | null>(null);
  const value = useMemo(() => {
    const stop = () => {
      const prior = active.current;
      active.current = null;
      prior?.controller.abort();
      prior?.stop();
    };
    return {
      consent,
      stop,
      current: () =>
        active.current !== null &&
        consent.isAuthorizationCurrent?.(active.current.request) === true,
      async authorize(model: string, invalidated: () => void) {
        stop();
        const controller = new AbortController();
        const request: OutboundProcessingRequest = {
          operationRunId: 'realtime-settings-session',
          providerId: 'openai-realtime',
          modelId: model,
          recipient: 'OpenAI Realtime API',
          remoteProcessing: true,
          consentScope: {
            purpose: 'realtime_audio',
            policyVersion: 'selected-realtime-v1',
            dataCategories: ['live_voice_audio', 'voice_conversation'],
          },
          allowedScope: { sourceKinds: ['personal_record'] },
          payload: {
            messages: [
              { role: 'user', content: 'Live audio conversation session' },
            ],
          },
          signal: controller.signal,
        };
        const owner = { controller, request, stop: () => {} };
        active.current = owner;
        try {
          if (
            (await consent.authorize(request)) !== 'authorized' ||
            active.current !== owner ||
            controller.signal.aborted
          ) {
            if (active.current === owner) stop();
            return false;
          }
          owner.stop =
            consent.subscribeAuthorizationInvalidation?.(request, () => {
              if (active.current === owner) {
                stop();
                invalidated();
              }
            }) ?? (() => {});
          if (active.current !== owner) owner.stop();
          const permitted =
            active.current === owner &&
            consent.isAuthorizationCurrent?.(request) === true;
          if (!permitted && active.current === owner) stop();
          return permitted;
        } catch {
          if (active.current === owner) stop();
          return false;
        }
      },
    };
  }, [consent]);
  useEffect(() => () => value.stop(), [value]);
  return value;
}
