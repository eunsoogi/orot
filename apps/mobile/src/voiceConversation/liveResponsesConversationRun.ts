import {
  bindCanonicalLiveHealthRun,
  type CanonicalLiveHealthSelection,
} from './bindCanonicalLiveHealthRun';
import { createCanonicalLiveSessionApproval } from './confirmCanonicalLiveSession';
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

type SessionApproval = ReturnType<typeof createCanonicalLiveSessionApproval>;
const unavailable = () => new Error('Live delegation unavailable');
export function liveResponsesConversationRun(input: {
  current: () => boolean;
  stop: () => void;
  confirm: (request: RealtimeToolConfirmationRequest) => Promise<boolean>;
}) {
  const native = nativeLiveManagedTools();
  const protection = native ? conversationExecutionNative() : null;
  let mode: CanonicalLiveHealthSelection | undefined;
  let review: SessionApproval | undefined;
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
    review?.retire();
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
    async credentials(id?: string) {
      clear();
      const ownedRevision = revision;
      const approval = (review = createCanonicalLiveSessionApproval());
      protectionRevoked = false;
      admittedResponses = false;
      const credentials = await loadLiveCallSettings();
      if (!native) return credentials;
      const selected = await loadLiveResponsesSettings(
        credentials.credentialEpoch,
      );
      const ownsStart = () => revision === ownedRevision && current();
      if (revision !== ownedRevision || selected.kind === 'unavailable')
        throw unavailable();
      if (selected.kind === 'active') {
        if (!execute || !selected.current() || protectionRevoked)
          throw unavailable();
        grant = selected;
        const detach = selected.subscribe(revoke);
        if (grant !== selected) {
          detach();
          throw unavailable();
        }
        unwatch = detach;
        if (native.canonicalAvailable && protection) {
          const result = await approval.confirm({
            id,
            selection: selected,
            current: ownsStart,
            protectedAvailable: protection.protectedDataAvailable,
            review: input.confirm,
            nativeReview: native.reviewCanonicalCall,
          });
          if (result.kind === 'stale' || !ownsStart()) throw unavailable();
          if (result.kind === 'denied') {
            clear();
            return credentials;
          }
          enabledModeCurrent = result.current;
          mode = result.kind === 'approved' ? result.companion : undefined;
        }
        admittedResponses = true;
      }
      return credentials;
    },
    nativeGrant(id: string) {
      if (!admittedResponses) return null;
      if (!grant || !current()) throw unavailable();
      if ((mode && !review?.allows(id)) || enabledModeCurrent?.() === false)
        throw unavailable();
      callId = id;
      return grant.nativeGrant;
    },
    canonicalRegistration(id: string) {
      if (!mode) return;
      if (!native || !protection || callId !== id || !current() || companion)
        throw unavailable();
      companion = bindCanonicalLiveHealthRun({
        id,
        selection: mode,
        native,
        protection,
        owner: () => callId === id && current(),
        confirm: input.confirm,
        revokeCall: revoke,
      });
      if (!companion) throw unavailable();
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
