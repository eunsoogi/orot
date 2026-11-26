import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import type { LiveToolBatch, LiveToolCall } from '@orot/agent-runtime';
import type { JsonObject } from '@orot/model-runtime';
import { stable } from '../aiFeatures/integration/stableEvidenceReference';

export type LiveCommonWitness = Readonly<{
  backendModel: string;
  credentialEpoch: string;
  grantID: string;
  generation: string;
  voiceGeneration: string;
}>;
export type LiveCommonRegistration = LiveCommonWitness &
  Readonly<{
    policy: 'common-tools-v3';
    providerId: 'openai-live-responses';
    recipient: 'OpenAI Responses (Live)';
    manifestRevision: 'canonical-health-context-v3';
    tools: readonly {
      name: string;
      description: string;
      parameters: JsonObject;
    }[];
  }>;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/u.test(value);
const generation = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);

function witness(raw: unknown): LiveCommonWitness | undefined {
  if (!record(raw)) return;
  const {
    backendModel,
    credentialEpoch,
    grantID,
    generation: responseGeneration,
    voiceGeneration,
  } = raw;
  if (
    !identifier(backendModel) ||
    !generation(credentialEpoch) ||
    !generation(responseGeneration) ||
    !generation(voiceGeneration) ||
    grantID !== responseGeneration + '-model'
  )
    return;
  return {
    backendModel,
    credentialEpoch,
    grantID,
    generation: responseGeneration,
    voiceGeneration,
  };
}

/** No consent, storage access, or emitter allocation is implied by this probe. */
function liveCommonNativeModule() {
  const module =
    Platform.OS === 'ios' ? NativeModules.VoiceRealtimeModule : null;
  if (
    module?.supportsLiveCommonConversationToolsV3 !== true ||
    typeof module.readLiveCommonConversationToolsWitness !== 'function' ||
    typeof module.isLiveCommonConversationToolCurrent !== 'function' ||
    typeof module.claimLiveCommonConversationResult !== 'function' ||
    typeof module.retireLiveCommonConversationResult !== 'function' ||
    typeof module.settleLiveCommonConversationResult !== 'function'
  )
    return;
  return module;
}

export function hasLiveCommonConversationRuntime() {
  return Boolean(liveCommonNativeModule());
}

/** A separate native V3 export; legacy/canonical-v2 device claims cannot open
 * a common tool port. No data or provider calls are performed by probing. */
export function nativeLiveCommonConversation() {
  const module = liveCommonNativeModule();
  if (!module) return;
  const emitter = new NativeEventEmitter(module);
  const subscribe = (name: string, listener: (event: unknown) => void) =>
    emitter.addListener(name, listener);
  return {
    async readWitness() {
      return witness(await module.readLiveCommonConversationToolsWitness());
    },
    challenge(call: LiveToolCall) {
      return (
        module.isLiveCommonConversationToolCurrent(
          call.callId,
          call.sessionId,
          call.delegationId,
          call.responseId,
          call.challengeId,
          call.toolCallId,
        ) === true
      );
    },
    claim(
      call: LiveToolCall,
      exactOutput: string,
      retireSource: (retire: () => void) => (() => void) | undefined,
    ) {
      const retire = () => {
        if (
          module.retireLiveCommonConversationResult(
            call.callId,
            call.challengeId,
          ) !== true
        )
          throw new Error('Native common result retirement unavailable');
      };
      const release = retireSource(retire);
      if (!release) return;
      try {
        if (
          module.claimLiveCommonConversationResult(
            call.callId,
            call.challengeId,
            exactOutput,
          ) === true
        )
          return () => {
            try {
              retire();
            } finally {
              release();
            }
          };
      } catch {
        /* There is no positive result authority. */
      }
      release();
    },
    async settle(call: LiveToolCall, exact: string | null) {
      return (
        (await module.settleLiveCommonConversationResult(
          call.callId,
          call.challengeId,
          exact,
        )) === true
      );
    },
    subscribe(
      callId: string,
      registration: LiveCommonRegistration,
      acceptsArguments: (name: string, args: string) => boolean,
      accept: (batch: LiveToolBatch) => void,
      cancel: (challengeId: string) => void,
    ) {
      let sessionId: string | undefined;
      const stamp = stable(registration);
      const ready = subscribe('VoiceRealtimeCommonToolsReady', event => {
        if (sessionId || !record(event) || event.callId !== callId) return;
        sessionId =
          identifier(event.sessionId) && stable(event.registration) === stamp
            ? event.sessionId
            : undefined;
      });
      const batches = subscribe('VoiceRealtimeCommonToolBatch', event => {
        if (
          !sessionId ||
          !record(event) ||
          event.manifestRevision !== registration.manifestRevision ||
          !record(event.owner) ||
          !Array.isArray(event.calls) ||
          event.calls.length !== 1
        )
          return;
        const {
          callId: id,
          sessionId: session,
          delegationId,
          responseId,
        } = event.owner;
        if (
          id !== callId ||
          session !== sessionId ||
          !identifier(delegationId) ||
          !identifier(responseId)
        )
          return;
        const entry: unknown = event.calls[0];
        if (
          !record(entry) ||
          entry.callId !== id ||
          entry.sessionId !== session ||
          entry.delegationId !== delegationId ||
          entry.responseId !== responseId ||
          !identifier(entry.challengeId) ||
          !identifier(entry.toolCallId) ||
          typeof entry.name !== 'string' ||
          !registration.tools.some(tool => tool.name === entry.name) ||
          typeof entry.args !== 'string' ||
          !acceptsArguments(entry.name, entry.args)
        )
          return;
        const owner = Object.freeze({
          callId,
          sessionId,
          delegationId,
          responseId,
        });
        const call = Object.freeze({
          ...owner,
          challengeId: entry.challengeId,
          toolCallId: entry.toolCallId,
          name: entry.name,
          args: entry.args,
        });
        accept({ owner, calls: [call] });
      });
      const cancelled = subscribe('VoiceRealtimeCommonToolCancelled', event => {
        if (
          record(event) &&
          event.callId === callId &&
          identifier(event.challengeId)
        )
          cancel(event.challengeId);
      });
      return () => {
        sessionId = undefined;
        ready.remove();
        batches.remove();
        cancelled.remove();
      };
    },
  };
}
