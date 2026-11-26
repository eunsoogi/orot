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
  let epoch = 0;
  const retire = () => {
    epoch += 1;
    prepared = undefined;
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
    ) {
      retire();
      const captured = epoch;
      const owns = () => epoch === captured && ownsCall();
      if (!native || !protection?.bridgeAvailable || !owns()) return;
      const available = async () =>
        owns() &&
        (await protection.protectedDataAvailable()) === true &&
        owns();
      if (!(await available())) return;
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
  readonly current: () => boolean;
  readonly credentials: typeof loadLiveCallSettings;
}) {
  const startup = liveCommonConversationStartup();
  const run = liveCommonConversationRun(
    () => input.injected ?? startup.port(),
    () =>
      AppState.currentState === 'active' &&
      input.current() &&
      ['listening', 'processing', 'speaking'].includes(
        input.readState()?.phase ?? '',
      ),
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
            .prepare(id, result.credentialEpoch, owns)
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
