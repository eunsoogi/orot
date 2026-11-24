import { AppState } from 'react-native';
import { liveResponsesConversationRun } from '../liveResponsesConversationRun';

const mockLoad = jest.fn();
const mockSettle = jest.fn();
const mockRevoke = jest.fn();
const mockScopeConfirm = jest.fn();
let mockIncoming: (event: unknown) => void;
jest.mock('../../voiceSettings/liveVoicePreferencesKeychain', () => ({
  loadLiveCallSettings: async () => ({ credentialEpoch: 'a'.repeat(64) }),
}));
jest.mock('../../voiceSettings/liveResponsesSettings', () => ({
  loadLiveResponsesSettings: (...args: unknown[]) => mockLoad(...args),
}));
jest.mock('../../aiFeatures/integration/localData', () => ({
  openAiFeatureLocalData: jest.fn(),
}));
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: () => ({
    bridgeAvailable: true,
    protectedDataAvailable: async () => true,
    subscribe: () => () => {},
  }),
}));
jest.mock('../nativeRealtimeVoice', () => ({
  nativeLiveManagedTools: () => ({
    settle: mockSettle,
    revoke: mockRevoke,
    subscribe: (listener: typeof mockIncoming) => {
      mockIncoming = listener;
      return () => {};
    },
  }),
}));
jest.mock('../liveResponsesHealthToolExecutor', () => ({
  createLiveResponsesHealthToolExecutor:
    (hooks: {
      isChallengeCurrent(call: unknown): boolean;
      resolveOwner(call: unknown): Promise<unknown>;
      settle(
        callId: string,
        challengeId: string,
        output: string,
      ): Promise<void>;
    }) =>
    async (event: { callId: string; challengeId: string }) => {
      if (!hooks.isChallengeCurrent(event)) return;
      const owner = await hooks.resolveOwner(event);
      mockScopeConfirm(owner);
      if (owner && hooks.isChallengeCurrent(event))
        await hooks.settle(event.callId, event.challengeId, 'fixture');
    },
}));

beforeEach(() => {
  jest.clearAllMocks();
  AppState.currentState = 'active';
  mockRevoke.mockResolvedValue(undefined);
});

it.each(['gpt-6-luna', 'gpt-6-sol'])(
  'owns %s through the Live runtime and retires on selection changes',
  async backendModel => {
    const generation = 'b'.repeat(64);
    const receipt = {
      backendModel,
      grantID: generation + '-model',
      generation,
    };
    const stop = jest.fn();
    let retire: () => void = () => {};
    mockLoad.mockResolvedValue({
      kind: 'active',
      nativeGrant: receipt,
      credentialEpoch: 'a'.repeat(64),
      current: () => true,
      subscribe: (callback: () => void) => {
        retire = callback;
        return () => {};
      },
    });
    const run = liveResponsesConversationRun({
      current: () => true,
      stop,
      confirm: jest.fn(),
    });
    await run.credentials();
    expect(run.nativeGrant('current-call')).toBe(receipt);
    mockIncoming({ callId: 'old-call', challengeId: 'old-tool' });
    mockIncoming({ callId: 'current-call', challengeId: 'current-tool' });
    for (let tick = 0; tick < 10; tick++) await Promise.resolve();
    expect(mockScopeConfirm).toHaveBeenCalledWith(
      expect.objectContaining(receipt),
    );
    expect(mockSettle).toHaveBeenCalledTimes(1);
    expect(mockSettle).toHaveBeenCalledWith(
      'current-call',
      'current-tool',
      'fixture',
    );

    retire();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(mockRevoke).toHaveBeenCalledWith(receipt);
    expect(() => run.nativeGrant('after-revoke')).toThrow(
      'Live delegation unavailable',
    );
    mockIncoming({ callId: 'current-call', challengeId: 'late-tool' });
    expect(mockSettle).toHaveBeenCalledTimes(1);
    run.dispose();
  },
);

it('leaves genuine off settings audio-only and rejects unavailable configured settings', async () => {
  const run = liveResponsesConversationRun({
    current: () => true,
    stop: jest.fn(),
    confirm: jest.fn(),
  });
  mockLoad.mockResolvedValueOnce({ kind: 'off' });
  await run.credentials();
  expect(run.nativeGrant('audio-only')).toBeNull();
  mockLoad.mockResolvedValueOnce({ kind: 'unavailable' });
  await expect(run.credentials()).rejects.toThrow(
    'Live delegation unavailable',
  );
  run.dispose();
});
