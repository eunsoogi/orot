// E2E-only entry. No native microphone, speech recognition, or provider is invoked.
import { useEffect, useRef, useState } from 'react';
import { AppRegistry, AppState, Text } from 'react-native';
import { name as appName } from '../app.json';
import { SavedVoiceCallIdentity } from '../src/voiceConversation/VoiceCallIdentity';
import { VoiceConversationScreen } from '../src/voiceConversation/VoiceConversationScreen';
import { createDuplexVoiceSession } from '../src/voiceConversation/duplexVoiceSession';
import type { VoiceConversationDependencies } from '../src/voiceConversation/createVoicePorts';
import type {
  NativeDuplexVoice,
  DuplexTranscript,
  DuplexSpeechStart,
} from '../src/voiceConversation/nativeDuplexVoice';
import { initialVoiceState } from '../src/voiceConversation/voiceTurn';

function syntheticCall() {
  let transcript: ((event: DuplexTranscript) => void) | undefined;
  let started: ((event: DuplexSpeechStart) => void) | undefined;
  let output: ((spoken: boolean) => void) | undefined;
  let callId = '';
  let generation = 0;
  const cancelOutput = () => {
    output?.(false);
    output = undefined;
  };
  const duplex: NativeDuplexVoice = {
    async open(id) {
      callId = id;
      generation = 0;
    },
    async stop() {
      callId = '';
      cancelOutput();
    },
    async interruptOutput() {
      cancelOutput();
    },
    speak: () =>
      new Promise(resolve => {
        output = resolve;
      }),
    finishCapture() {
      if (!callId) return;
      generation++;
      started?.({ callId, generation });
      transcript?.({ callId, generation, text: 'Synthetic fixture input' });
    },
    onTranscript(listener) {
      transcript = listener;
      return () => {
        transcript = undefined;
      };
    },
    onSpeechStarted(listener) {
      started = listener;
      return () => {
        started = undefined;
      };
    },
    onInterrupted: () => () => {},
  };
  const native: VoiceConversationDependencies['native'] = {
    duplex,
    start: async () => '',
    finishCapture: () => {},
    speak: async () => {},
    stop: async () => {},
    onInterrupted: () => () => {},
    onListening: () => () => {},
  };
  return { native, duplex };
}

function VoiceCallProbeEntry() {
  const [state, setState] = useState(initialVoiceState);
  const [visible, setVisible] = useState(true);
  const session = useRef<ReturnType<typeof createDuplexVoiceSession> | null>(
    null,
  );
  useEffect(() => {
    const fixture = syntheticCall();
    const controller = createDuplexVoiceSession(
      {
        native: fixture.native,
        language: 'ko-KR',
        authorize: async () => true,
        isCurrent: () => true,
        photoPending: () => false,
        submit: async () => 'Synthetic fixture output',
        cancel: async () => {},
      },
      fixture.duplex,
      setState,
    );
    session.current = controller;
    controller.start({
      sessionId: 1,
      providerId: 'synthetic',
      turnId: 'fixture',
    });
    const subscription = AppState.addEventListener('change', value => {
      if (value === 'background') controller.stop();
    });
    return () => {
      subscription.remove();
      controller.dispose();
      session.current = null;
    };
  }, []);
  return (
    <>
      <Text testID="voice-fixture-state">
        {visible ? state.phase : 'closed'}
      </Text>
      <VoiceConversationScreen
        visible={visible}
        phase={state.phase}
        status={`Synthetic ${state.phase}`}
        identity={
          <SavedVoiceCallIdentity
            value={{ avatar: 'star', name: 'Orot synthetic fixture' }}
          />
        }
        onEnd={() => {
          session.current?.stop();
          setVisible(false);
        }}
        onMute={() => {
          session.current?.stop();
        }}
        onResume={() => {
          session.current?.resume();
        }}
        onInterrupt={() => {
          session.current?.interrupt();
        }}
        onFinish={() => {
          session.current?.finish();
        }}
      />
    </>
  );
}
AppRegistry.registerComponent(appName, () => VoiceCallProbeEntry);
