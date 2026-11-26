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
    isLiveCommonConversationToolCurrent: jest.fn(() => true),
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
