import { act, waitFor } from '@testing-library/react-native';
import { AppState, DeviceEventEmitter, NativeModules } from 'react-native';
import {
  canonicalLiveCommonRegistration,
  createLiveCommonHealthPort,
} from '../createLiveCommonHealthPort';
import { liveCommonConversationRun } from '../liveCommonConversationRun';
import { nativeLiveCommonConversation } from '../nativeLiveCommonConversation';
import {
  emitFakeLiveReadyBatch,
  fakeLiveCommonNative,
  witness,
} from '../testSupport/fakeLiveCommonNative';
import { fixture } from '../testSupport/liveResponsesProtectedFixture';

jest.mock('../../voiceSettings/liveConversationToolsAuthorization', () => ({
  liveConversationToolsAuthorization: (
    _settings: unknown,
    current: () => boolean,
  ) => ({
    authorize: async () => 'authorized',
    isAuthorizationCurrent: current,
  }),
}));

test('native retirement cancels only the owned stock read', async () => {
  const storage = await fixture();
  const priorNative = NativeModules.VoiceRealtimeModule;
  const phase = AppState.currentState;
  AppState.currentState = 'active';
  const bridge = fakeLiveCommonNative();
  let challenge = 'current';
  bridge.isLiveCommonConversationToolCurrent.mockImplementation(
    (_call, _session, _delegation, _response, id) => id === challenge,
  );
  NativeModules.VoiceRealtimeModule = bridge;
  const registration = canonicalLiveCommonRegistration(witness);
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const stock = storage.read.getMockImplementation();
  if (!stock) throw new Error('Missing the actual stock reader.');
  let signal: AbortSignal | undefined;
  let stockFinished: Promise<unknown> | undefined;
  storage.read.mockImplementationOnce(async (...args) => {
    signal = args[2];
    const finished = gate.then(() => stock(...args));
    stockFinished = finished.catch(error => error);
    return finished;
  });
  const native = nativeLiveCommonConversation();
  if (!native) throw new Error('Missing the fixture native bridge.');
  const port = createLiveCommonHealthPort({
    native,
    registration,
    settings: {
      kind: 'active',
      commonToolsPolicy: 'common-tools-v3',
      current: () => true,
    } as Parameters<typeof createLiveCommonHealthPort>[0]['settings'],
    current: () => true,
    toolOwnerCurrent: () => true,
    protectedDataAvailable: async () => true,
    openData: storage.openData,
  });
  const run = liveCommonConversationRun(() => port, () => true);
  try {
    run.attach('owned-live');
    emitFakeLiveReadyBatch('owned-live', registration, challenge);
    await waitFor(() => expect(signal).toBeDefined());
    const cancel = (challengeId: string) =>
      DeviceEventEmitter.emit('VoiceRealtimeCommonToolCancelled', {
        callId: 'owned-live',
        challengeId,
      });
    await act(() => {
      cancel('foreign');
    });
    expect(signal?.aborted).toBe(false);
    await act(() => {
      challenge = 'retired';
      cancel('current');
    });
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      release();
      await stockFinished;
    });
    expect(storage.read).toHaveBeenCalledTimes(1);
    expect(bridge.claimLiveCommonConversationResult).not.toHaveBeenCalled();
    expect(bridge.settleLiveCommonConversationResult).not.toHaveBeenCalled();
    expect(bridge.closeLiveCall).not.toHaveBeenCalled();
  } finally {
    run.retire();
    release();
    await stockFinished;
    AppState.currentState = phase;
    NativeModules.VoiceRealtimeModule = priorNative;
    storage.close();
  }
});
