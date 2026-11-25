import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { useEffect, useMemo } from 'react';
import { AppState, Pressable, Text } from 'react-native';
import { liveResponsesConversationRun } from '../liveResponsesConversationRun';
import { useRealtimeToolConfirmation } from '../useRealtimeToolConfirmation';

const mockStartup = jest.fn();
const mockGrant = jest.fn();
const mockRegister = jest.fn();
const mockProtected = jest.fn();
const mockResolveRun = jest.fn();
jest.mock('../../voiceSettings/liveVoicePreferencesKeychain', () => ({
  loadLiveCallSettings: async () => ({ credentialEpoch: 'account' }),
}));
jest.mock('../../voiceSettings/liveResponsesSettings', () => ({
  loadLiveResponsesSettings: () => mockGrant(),
}));
jest.mock('../../voiceSettings/liveCanonicalHealthSettings', () => ({
  readCanonicalLiveHealthStartup: () => mockStartup(),
}));
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: () => ({
    bridgeAvailable: true,
    protectedDataAvailable: mockProtected,
    subscribe: () => () => {},
  }),
}));
jest.mock('../nativeRealtimeVoice', () => ({
  nativeLiveManagedTools: () => ({
    canonicalAvailable: true,
    subscribe: () => () => {},
    revoke: async () => {},
  }),
}));
jest.mock('../liveResponsesHealthToolExecutor', () => ({
  createLiveResponsesHealthToolExecutor: () => jest.fn(),
}));
jest.mock('../bindCanonicalLiveHealthRun', () => ({
  ...jest.requireActual('../bindCanonicalLiveHealthRun'),
  bindCanonicalLiveHealthRun: (...args: unknown[]) => mockRegister(...args),
}));

const nativeGrant = {
  generation: 'baseline',
  backendModel: 'gpt-6-sol',
};
const companion = {
  binding: {
    generation: 'companion',
    legacyGeneration: nativeGrant.generation,
    backendModel: nativeGrant.backendModel,
    credentialEpoch: 'account',
  },
  current: () => true,
};
function Entry() {
  const decision = useRealtimeToolConfirmation(true);
  const run = useMemo(
    () =>
      liveResponsesConversationRun({
        current: () => true,
        stop: () => {},
        confirm: decision.confirm,
      }),
    [decision.confirm],
  );
  useEffect(() => () => run.dispose(), [run]);
  return (
    <>
      <Pressable
        onPress={() => mockResolveRun(run, run.credentials('owned-live-call'))}
      >
        <Text>Start Live call</Text>
      </Pressable>
      {decision.node}
    </>
  );
}

test.each(['approved', 'denied', 'locked'] as const)(
  'the current Live session asks separately before canonical registration: %s',
  async outcome => {
    const prior = AppState.currentState;
    AppState.currentState = 'active';
    jest.clearAllMocks();
    mockGrant.mockResolvedValue({
      kind: 'active',
      nativeGrant,
      credentialEpoch: 'account',
      current: () => true,
      subscribe: () => () => {},
    });
    mockStartup.mockResolvedValue({ kind: 'active', companion });
    mockProtected.mockResolvedValue(true);
    mockRegister.mockReturnValue({
      registration: { exact: 'synthetic' },
      retire: () => {},
    });
    const view = await render(<Entry />);
    try {
      await fireEvent.press(screen.getByText('Start Live call'));
      const [run, credentials] = mockResolveRun.mock.calls[0] as [
        ReturnType<typeof liveResponsesConversationRun>,
        Promise<unknown>,
      ];
      const completion = credentials.then(
        () => true,
        () => false,
      );
      await waitFor(() =>
        expect(
          screen.getByText('이번 통화에서 건강 기록 도구를 사용할까요?'),
        ).toBeTruthy(),
      );
      expect(run.nativeGrant('owned-live-call')).toBeNull();
      expect(run.canonicalRegistration('owned-live-call')).toBeUndefined();
      expect(mockRegister).not.toHaveBeenCalled();
      if (outcome === 'locked') mockProtected.mockResolvedValue(false);
      await fireEvent.press(
        screen.getByTestId(
          outcome === 'denied'
            ? 'realtime-tool-confirmation-cancel'
            : 'realtime-tool-confirmation-allow',
        ),
      );
      await act(async () => {
        expect(await completion).toBe(outcome !== 'locked');
      });
      if (outcome === 'approved') {
        expect(() => run.nativeGrant('different-call')).toThrow();
        expect(() => run.canonicalRegistration('owned-live-call')).toThrow();
        expect(run.nativeGrant('owned-live-call')).toBe(nativeGrant);
        expect(run.canonicalRegistration('owned-live-call')).toEqual({
          exact: 'synthetic',
        });
        expect(mockRegister).toHaveBeenCalledTimes(1);
      } else {
        expect(run.nativeGrant('owned-live-call')).toBeNull();
        expect(run.canonicalRegistration('owned-live-call')).toBeUndefined();
        expect(mockRegister).not.toHaveBeenCalled();
      }
    } finally {
      await view.unmount();
      AppState.currentState = prior;
    }
  },
);
