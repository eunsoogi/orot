import { startLiveCommonHealthTiming } from './liveCommonHealthTiming';
import { AppState } from 'react-native';
import {
  liveCommonConversationRun,
  type LiveCommonConversationPort,
} from './liveCommonConversationRun';
import type { loadLiveCallSettings } from '../voiceSettings/liveVoicePreferencesKeychain';
import type { VoiceState } from './voiceTurn';
import { conversationExecutionNative } from '../ragConversation/conversationExecutionNative';
import { loadLiveResponsesSettings } from '../voiceSettings/liveResponsesSettings';
import {
  canonicalLiveCommonRegistration,
  createLiveCommonHealthPort,
} from './createLiveCommonHealthPort';
import {
  nativeLiveCommonConversation,
  type LiveCommonRegistration,
} from './nativeLiveCommonConversation';

export function liveCommonConversationStartup() {
  const native = nativeLiveCommonConversation();
  const protection = native ? conversationExecutionNative() : null;
  let prepared:
    | {
        callId: string;
        registration: LiveCommonRegistration;
        port: ReturnType<typeof createLiveCommonHealthPort>;
      }
    | undefined;
  let stopProtection: (() => void) | undefined;
  let epoch = 0;
  const retire = () => {
    epoch += 1;
    prepared = undefined;
    stopProtection?.();
    stopProtection = undefined;
  };
  return {
    retire,
    port: () => prepared?.port,
    registration(callId: string) {
      return prepared?.callId === callId && prepared.port.current()
        ? prepared.registration
        : undefined;
    },
    async prepare(
      callId: string,
      credentialEpoch: string,
      ownsCall: () => boolean,
      toolOwnerCurrent: () => boolean,
      cancelCurrent: () => void,
    ) {
      retire();
      const captured = epoch;
      let locked = false;
      let protectionEpoch = 0;
      const owns = () => epoch === captured && ownsCall();
      const protectedOwner = () => owns() && !locked;
      if (!native || !protection?.bridgeAvailable || !owns()) return;
      // A lock retires the pending challenge even if unlock races a held read.
      stopProtection = protection.subscribe(event => {
        if (
          epoch !== captured ||
          event.kind !== 'protectedData' ||
          event.available === !locked
        )
          return;
        locked = !event.available;
        ++protectionEpoch;
        if (locked) cancelCurrent();
      });
      const available = async () => {
        const checked = protectionEpoch;
        return (
          protectedOwner() &&
          (await protection.protectedDataAvailable()) === true &&
          protectedOwner() &&
          checked === protectionEpoch
        );
      };
      if (!(await available())) return;
      const grantLookup = startLiveCommonHealthTiming('grant_lookup');
      const [selection, witness] = await Promise.all([
        loadLiveResponsesSettings(credentialEpoch, 'tool-reproof'),
        native.readWitness(),
      ]);
      if (
        selection.kind !== 'active' ||
        selection.commonToolsPolicy !== 'common-tools-v3' ||
        !selection.current() ||
        !witness ||
        witness.credentialEpoch !== credentialEpoch ||
        witness.credentialEpoch !== selection.credentialEpoch ||
        witness.backendModel !== selection.nativeGrant.backendModel ||
        witness.generation !== selection.nativeGrant.generation ||
        witness.grantID !== selection.nativeGrant.grantID ||
        !(await available()) ||
        !selection.current()
      )
        return;
      grantLookup();
      const registration = canonicalLiveCommonRegistration(witness);
      const current = () => owns() && selection.current();
      prepared = {
        callId,
        registration,
        port: createLiveCommonHealthPort({
          native,
          registration,
          settings: selection,
          current,
          toolOwnerCurrent: () => protectedOwner() && toolOwnerCurrent(),
          protectedDataAvailable: available,
          openData: () => {
            const { openAiFeatureLocalData } =
              require('../aiFeatures/integration/localData') as typeof import('../aiFeatures/integration/localData');
            return openAiFeatureLocalData();
          },
        }),
      };
    },
  };
}

/** Associate prepared V3 authority with the same ID the production audio
 * session is about to open; late credentials can never revive a stopped call. */
export function bindLiveCommonConversationStartup(input: {
  readonly injected?: LiveCommonConversationPort;
  readonly readState: () => VoiceState | undefined;
  readonly ownsSystemCall: (id: string) => boolean;
  readonly current: () => boolean;
  readonly credentials: typeof loadLiveCallSettings;
}) {
  const startup = liveCommonConversationStartup();
  // Background access requires the current, native-owned CallKit audio call.
  // Neither a retained React screen nor a synthetic AppState can renew it.
  const toolOwnerCurrent = (id: string) => {
    const state = input.readState();
    const phase = AppState.currentState;
    return (
      state?.identity?.turnId === id &&
      input.current() &&
      ['listening', 'processing', 'speaking'].includes(state.phase) &&
      (phase === 'active' ||
        ((phase === 'inactive' || phase === 'background') &&
          input.ownsSystemCall(id)))
    );
  };
  const run = liveCommonConversationRun(
    () => input.injected ?? startup.port(),
    () => {
      const id = input.readState()?.identity?.turnId;
      return Boolean(id && toolOwnerCurrent(id));
    },
  );
  return {
    cancelCurrent: run.cancelCurrent,
    registration: startup.registration,
    async credentials(id: string) {
      const result = await input.credentials();
      const owns = () =>
        input.readState()?.identity?.turnId === id && input.current();
      if (id && owns()) {
        if (!input.injected)
          await startup
            .prepare(
              id,
              result.credentialEpoch,
              owns,
              () => toolOwnerCurrent(id),
              run.cancelCurrent,
            )
            .catch(() => undefined);
        if (owns()) run.attach(id);
      }
      return result;
    },
    retire() {
      startup.retire();
      run.retire();
    },
  };
}
