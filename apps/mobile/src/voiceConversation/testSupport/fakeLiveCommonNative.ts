import { act } from '@testing-library/react-native';
import { DeviceEventEmitter } from 'react-native';
import type { LiveCommonRegistration } from '../nativeLiveCommonConversation';

export const witness = {
  backendModel: 'gpt-6-sol',
  credentialEpoch: 'c'.repeat(64),
  generation: 'a'.repeat(64),
  grantID: 'a'.repeat(64) + '-model',
  voiceGeneration: 'b'.repeat(64),
};

export function fakeLiveCommonNative(settle?: () => Promise<boolean>) {
  return {
    openLiveCall: jest.fn(
      async (
        _id: string,
        _model: string,
        _key: string,
        _options: { commonToolsRegistration?: LiveCommonRegistration },
      ) => {},
    ),
    closeLiveCall: jest.fn(async () => ({})),
    stopRealtimeCall: jest.fn(async () => {}),
    interruptRealtimeOutput: jest.fn(),
    pauseRealtimeCall: jest.fn(),
    resumeRealtimeCall: jest.fn(),
    addListener: jest.fn(),
    removeListeners: jest.fn(),
    supportsLiveCommonConversationToolsV3: true,
    readLiveCommonConversationToolsWitness: jest.fn(async () => witness),
    isLiveCommonConversationToolCurrent: jest.fn(
      (
        _1: string,
        _2: string,
        _3: string,
        _4: string,
        _challenge: string,
        _tool: string,
      ) => true,
    ),
    claimLiveCommonConversationResult: jest.fn(
      (_id: string, _challenge: string, _bytes: string) => true,
    ),
    retireLiveCommonConversationResult: jest.fn(() => true),
    settleLiveCommonConversationResult: jest.fn(
      async (_id: string, _challenge: string, _approved: string) =>
        settle ? settle() : true,
    ),
  };
}

export function emitFakeLiveCommonBatch(
  callId: string,
  registration: LiveCommonRegistration,
  challengeId: string,
  sessionId = 'native-session',
) {
  const owner = {
    callId,
    sessionId,
    delegationId: 'delegation-' + challengeId,
    responseId: 'response-' + challengeId,
  };
  DeviceEventEmitter.emit('VoiceRealtimeCommonToolBatch', {
    owner,
    manifestRevision: registration.manifestRevision,
    calls: [
      {
        ...owner,
        name: 'local-health-context',
        challengeId,
        toolCallId: 'tool-' + challengeId,
        args: '{"topics":["measurements"],"days":7}',
      },
    ],
  });
}

export async function assertFakeLiveCommonSuccessor(input: {
  mode: 'successor-before-promise' | 'successor-revoked' | 'predecessor-failed';
  callId: string;
  registration: LiveCommonRegistration;
  native: ReturnType<typeof fakeLiveCommonNative>;
  finish?: (value: boolean) => void;
  current(value: string): void;
}) {
  const { callId, registration, native, finish, mode, current } = input;
  await act(() => {
    current('next');
    // An exact native-current function ID from a different session cannot queue.
    emitFakeLiveCommonBatch(callId, registration, 'next', 'different-session');
    // The real successor can arrive before RN resolves the predecessor Promise.
    emitFakeLiveCommonBatch(callId, registration, 'next');
  });
  expect(native.settleLiveCommonConversationResult).toHaveBeenCalledTimes(1);
  expect(finish).toBeDefined();
  await act(() => {
    if (mode === 'successor-revoked') current('revoked');
    finish?.(mode !== 'predecessor-failed');
  });
  const count = mode === 'successor-before-promise' ? 2 : 1;
  expect(native.settleLiveCommonConversationResult).toHaveBeenCalledTimes(
    count,
  );
  expect(native.claimLiveCommonConversationResult).toHaveBeenCalledTimes(count);
  if (mode === 'successor-before-promise') {
    expect(native.settleLiveCommonConversationResult.mock.calls[1]?.[1]).toBe(
      'next',
    );
    await act(() => {
      emitFakeLiveCommonBatch(callId, registration, 'next');
    });
    expect(native.settleLiveCommonConversationResult).toHaveBeenCalledTimes(2);
  }
}

export function assertFakeLiveCommonResult(
  native: ReturnType<typeof fakeLiveCommonNative>,
) {
  const [id, challenge, bytes] =
    native.settleLiveCommonConversationResult.mock.calls[0]!;
  expect(native.claimLiveCommonConversationResult).toHaveBeenCalledWith(
    id,
    challenge,
    bytes,
  );
  expect(JSON.parse(bytes)).toMatchObject({
    tool: 'local-health-context',
    items: [{ evidenceId: expect.any(String), content: expect.any(String) }],
  });
  expect(bytes).not.toMatch(
    /synthetic-health-id|delegation|topics|native-session/,
  );
  return { id, challenge };
}
