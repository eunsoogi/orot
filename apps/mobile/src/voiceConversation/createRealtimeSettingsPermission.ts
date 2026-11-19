import type {
  ExecutionConsentPort,
  OutboundProcessingRequest,
} from '@orot/agent-runtime';

/** A single run owns this lease. Native hosts may exercise the exact lifecycle with
 * a synthetic consent port; no authorization verdict is shared between calls. */
export function createRealtimeSettingsPermission(
  consent: ExecutionConsentPort,
) {
  let active: {
    controller: AbortController;
    request: OutboundProcessingRequest;
    stop: () => void;
  } | null = null;
  const stop = () => {
    const prior = active;
    active = null;
    prior?.controller.abort();
    prior?.stop();
  };
  return {
    consent,
    stop,
    current: () =>
      active !== null &&
      consent.isAuthorizationCurrent?.(active.request) === true,
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
      active = owner;
      try {
        if (
          (await consent.authorize(request)) !== 'authorized' ||
          active !== owner ||
          controller.signal.aborted
        ) {
          if (active === owner) stop();
          return false;
        }
        owner.stop =
          consent.subscribeAuthorizationInvalidation?.(request, () => {
            if (active === owner) {
              stop();
              invalidated();
            }
          }) ?? (() => {});
        if (active !== owner) owner.stop();
        const permitted =
          active === owner &&
          consent.isAuthorizationCurrent?.(request) === true;
        if (!permitted && active === owner) stop();
        return permitted;
      } catch {
        if (active === owner) stop();
        return false;
      }
    },
  };
}
