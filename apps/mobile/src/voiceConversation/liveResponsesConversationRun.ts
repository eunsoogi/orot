import {
  bindCanonicalLiveHealthRun,
  matchesCanonicalLiveHealthOwner,
  type CanonicalLiveHealthSelection,
} from './bindCanonicalLiveHealthRun';
import { readCanonicalLiveHealthStartup } from '../voiceSettings/liveCanonicalHealthSettings';
import { AppState } from 'react-native';
import { conversationExecutionNative } from '../ragConversation/conversationExecutionNative';
import { loadLiveCallSettings } from '../voiceSettings/liveVoicePreferencesKeychain';
import {
  loadLiveResponsesSettings,
  type LiveResponsesSettings,
} from '../voiceSettings/liveResponsesSettings';
import { createLiveResponsesHealthToolExecutor } from './liveResponsesHealthToolExecutor';
import { nativeLiveManagedTools } from './nativeRealtimeVoice';
import type { RealtimeToolConfirmationRequest } from './useRealtimeToolConfirmation';

export function liveResponsesConversationRun(input: {
  current: () => boolean;
  stop: () => void;
  confirm: (request: RealtimeToolConfirmationRequest) => Promise<boolean>;
}) {
  const native = nativeLiveManagedTools();
  const protection = native ? conversationExecutionNative() : null;
  let mode: CanonicalLiveHealthSelection | undefined;
  let enabledModeCurrent: (() => boolean) | undefined;
  let companion: ReturnType<typeof bindCanonicalLiveHealthRun>;
  let protectionRevoked = false;
  let revision = 0;
  let admittedResponses = false;
  let grant: Extract<LiveResponsesSettings, { kind: 'active' }> | null = null;
  let unwatch: (() => void) | undefined;
  let callId: string | undefined;
  let challenge:
    { callId: string; challengeId: string; abort: AbortController } | undefined;
  const clear = () => {
    ++revision;
    companion?.retire();
    companion = undefined;
    mode = undefined;
    enabledModeCurrent = undefined;
    challenge?.abort.abort();
    challenge = undefined;
    callId = undefined;
    grant = null;
    unwatch?.();
    unwatch = undefined;
  };
  const revoke = () => {
    const old = grant;
    clear();
    if (old) {
      native?.revoke(old.nativeGrant).catch(() => undefined);
      input.stop();
    }
  };
  const current = () =>
    !protectionRevoked &&
    AppState.currentState === 'active' &&
    input.current() &&
    grant?.current() === true;
  const protectedSubscription = protection?.subscribe(event => {
    if (
      (event.kind === 'protectedData' && !event.available) ||
      AppState.currentState === 'background'
    ) {
      protectionRevoked = true;
      revoke();
    }
  });
  const execute =
    native && protection?.bridgeAvailable === true
      ? createLiveResponsesHealthToolExecutor({
          isChallengeCurrent: call =>
            current() &&
            callId === call.callId &&
            challenge?.challengeId === call.challengeId,
          async resolveOwner(call) {
            const selected = grant;
            if (!selected || !current() || callId !== call.callId) return null;
            const receipt = await loadLiveResponsesSettings(
              selected.credentialEpoch,
            );
            if (
              receipt.kind !== 'active' ||
              grant !== selected ||
              !current() ||
              receipt.nativeGrant.generation !==
                selected.nativeGrant.generation ||
              receipt.nativeGrant.backendModel !==
                selected.nativeGrant.backendModel
            )
              return null;
            return {
              ...receipt.nativeGrant,
              backend: 'openai-live-responses',
              recipient: 'OpenAI Responses (Live)',
              resultKind: 'health_aggregate',
              credentialEpoch: receipt.credentialEpoch,
              current: () =>
                grant === selected && current() && receipt.current(),
            };
          },
          protectedDataAvailable: () => protection.protectedDataAvailable(),
          protectedDataCurrent: current,
          confirm: ({ owner, scope, signal }) =>
            input.confirm({
              text: JSON.stringify(scope),
              use: 'live-local-read',
              recipient: owner.recipient,
              model: owner.backendModel,
              signal,
            }),
          async authorizeResult({ owner, signal }, output) {
            if (
              !(await input.confirm({
                text: output,
                use: 'live-outbound-result',
                recipient: owner.recipient,
                model: owner.backendModel,
                signal,
              }))
            )
              return null;
            return () => !signal.aborted && current() && owner.current();
          },
          // Audio-only startup must not initialize protected local evidence storage.
          openData: async () =>
            (
              await import('../aiFeatures/integration/localData')
            ).openAiFeatureLocalData(),
          holdDelivery: native.holdDelivery,
          settle: native.settle,
        })
      : null;
  const stopEvents =
    execute &&
    native?.subscribe(
      incoming => {
        if (!current() || callId !== incoming.callId || challenge) return;
        if (mode) {
          companion?.accept(incoming);
          return;
        }
        if (incoming.name !== 'orot_health_context') return;
        const running = {
          callId: incoming.callId,
          challengeId: incoming.challengeId,
          abort: new AbortController(),
        };
        challenge = running;
        execute(incoming, running.abort.signal).finally(() => {
          if (challenge === running) challenge = undefined;
        });
      },
      (cancelledCall, id) => {
        if (mode) {
          companion?.cancel(cancelledCall, id);
          return;
        }
        if (
          challenge?.callId === cancelledCall &&
          challenge.challengeId === id
        ) {
          challenge.abort.abort();
          challenge = undefined;
        }
      },
    );
  return {
    async credentials() {
      clear();
      const ownedRevision = revision;
      protectionRevoked = false;
      admittedResponses = false;
      const credentials = await loadLiveCallSettings();
      // Older native modules cannot make this mode available; their existing audio path stays intact.
      if (!native) return credentials;
      const selected = await loadLiveResponsesSettings(
        credentials.credentialEpoch,
      );
      if (revision !== ownedRevision || selected.kind === 'unavailable')
        throw new Error('Live delegation unavailable');
      if (selected.kind === 'active') {
        admittedResponses = true;
        if (!execute || !selected.current() || protectionRevoked)
          throw new Error('Live delegation unavailable');
        grant = selected;
        const detach = selected.subscribe(revoke);
        if (grant !== selected) {
          detach();
          throw new Error('Live delegation unavailable');
        }
        unwatch = detach;
        if (native.canonicalAvailable) {
          const startup = await readCanonicalLiveHealthStartup(selected);
          if (startup.kind === 'unavailable')
            throw new Error('Live delegation unavailable');
          const candidate =
            startup.kind === 'active' ? startup.companion : undefined;
          if (revision !== ownedRevision || grant !== selected || !current())
            throw new Error('Live delegation unavailable');
          if (
            candidate &&
            !matchesCanonicalLiveHealthOwner(candidate, selected)
          )
            throw new Error('Live delegation unavailable');
          mode = candidate;
          enabledModeCurrent =
            startup.kind === 'off'
              ? startup.current
              : startup.companion.current;
        }
      }
      return credentials;
    },
    nativeGrant(id: string) {
      if (!admittedResponses) return null;
      if (!grant) throw new Error('Live delegation unavailable');
      if (!current() || (enabledModeCurrent && !enabledModeCurrent()))
        throw new Error('Live delegation unavailable');
      callId = id;
      return grant.nativeGrant;
    },
    canonicalRegistration(id: string) {
      if (!mode) return;
      if (!native || !protection || callId !== id || !current() || companion)
        throw new Error('Live delegation unavailable');
      companion = bindCanonicalLiveHealthRun({
        id,
        selection: mode,
        native,
        protection,
        owner: () => callId === id && current(),
        confirm: input.confirm,
        revokeCall: revoke,
      });
      if (!companion) throw new Error('Live delegation unavailable');
      return companion.registration;
    },
    retire: clear,
    dispose() {
      revoke();
      if (stopEvents) stopEvents();
      protectedSubscription?.();
    },
  };
}
