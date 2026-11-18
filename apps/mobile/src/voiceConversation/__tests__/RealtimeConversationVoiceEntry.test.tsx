import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert, AppState } from 'react-native';
import { mockNative, realtimeEvents } from './realtimeNativeEventsFixture';
import { RealtimeConversationVoiceEntry } from '../RealtimeConversationVoiceEntry';
import type { ConversationSessions } from '../../ragConversation/conversationSessionTypes';

// Settings authorization is tested with real ownership separately; this component fixture controls its asynchronous boundary.
import {
  mockAuthorize,
  mockPermission,
} from './realtimeSettingsPermissionFixture';
jest.mock('../useRealtimeSettingsPermission', () => ({
  useRealtimeSettingsPermission: () => mockPermission,
}));
beforeEach(() => {
  mockAuthorize.mockReset().mockResolvedValue(true);
});

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../assistantAppearance/AssistantHeader', () => ({
  AssistantHeader: () => null,
}));
const mockCredentials = jest.fn(async (_model: string) => ({
  model: 'gpt-realtime-2.1',
  apiKey: 'synthetic-key',
}));
jest.mock('../../voiceSettings/voiceSettingsStore', () => ({
  voiceSettingsStore: {
    realtimeCredentials: (model: string) => mockCredentials(model),
    subscribe: () => () => {},
  },
}));
jest.mock('../nativeRealtimeVoice', () => ({
  nativeRealtimeVoice: () => mockNative,
}));

it('uses settings audio approval without a repeated modal, preserves drafts and never calls the selected text model', async () => {
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  let appChanged: (
    state: 'active' | 'inactive' | 'background',
  ) => void = () => {};
  const appSubscription = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_type, listener) => {
      appChanged = listener;
      return { remove: jest.fn() };
    });
  const snapshot = {
    activeId: 1,
    sessions: [{ id: 1, draft: 'untouched draft' }],
  };
  const store = {
    getSnapshot: () => snapshot,
    photoDrafts: { get: () => ({ status: 'empty' }) },
  } as unknown as ConversationSessions;
  const resolveSelectedAi = jest.fn();
  const onSend = jest.fn();
  await render(
    <RealtimeConversationVoiceEntry
      model="gpt-realtime-2.1"
      store={store}
      sessionId={1}
      busy={false}
      photoPending={false}
      selectionRevision={0}
      resolveSelectedAi={resolveSelectedAi}
      onSend={onSend}
    />,
  );
  await fireEvent.press(screen.getByRole('button', { name: '음성 대화 시작' }));
  expect(mockAuthorize).toHaveBeenCalledWith(
    'gpt-realtime-2.1',
    expect.any(Function),
  );
  expect(alert).not.toHaveBeenCalled();
  await waitFor(() => expect(mockNative.open).toHaveBeenCalledTimes(1));
  await act(async () => {
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'inactive',
    });
    appChanged('inactive');
  });
  expect(mockNative.stop).not.toHaveBeenCalled();
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
  expect(resolveSelectedAi).not.toHaveBeenCalled();
  expect(onSend).not.toHaveBeenCalled();
  expect(snapshot.sessions[0].draft).toBe('untouched draft');
  expect(screen.queryByTestId('voice-call-finish')).toBeNull();
  const id = mockNative.open.mock.calls[0][0];
  await act(async () => {
    realtimeEvents.systemCall(id, true);
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'background',
    });
    appChanged('background');
  });
  expect(mockNative.stop).not.toHaveBeenCalled();
  await act(async () => {
    realtimeEvents.systemCall(id, false);
  });
  await waitFor(() => expect(mockNative.stop).toHaveBeenCalledTimes(1));

  await fireEvent.press(screen.getByTestId('voice-call-end'));
  await waitFor(() => expect(mockNative.stop).toHaveBeenCalledTimes(1));
  alert.mockRestore();
  appSubscription.mockRestore();
});

it('does not reuse pending consent for a different conversation with the same model', async () => {
  jest.clearAllMocks();
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
  const appSubscription = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation(() => ({ remove: jest.fn() }));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const snapshot = { activeId: 1, sessions: [{ id: 1 }, { id: 2 }] };
  const store = {
    getSnapshot: () => snapshot,
    photoDrafts: { get: () => ({ status: 'empty' }) },
  } as unknown as ConversationSessions;
  const props = {
    model: 'gpt-realtime-2.1',
    store,
    busy: false,
    photoPending: false,
    selectionRevision: 0,
    resolveSelectedAi: jest.fn(),
    onSend: jest.fn(),
  };
  const view = await render(
    <RealtimeConversationVoiceEntry {...props} sessionId={1} />,
  );
  let complete!: (value: boolean) => void;
  mockAuthorize.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        complete = resolve;
      }),
  );
  await fireEvent.press(screen.getByRole('button', { name: '음성 대화 시작' }));
  expect(mockNative.open).not.toHaveBeenCalled();
  snapshot.activeId = 2;
  await view.rerender(
    <RealtimeConversationVoiceEntry {...props} sessionId={2} />,
  );
  await act(async () => {
    complete(true);
  });
  expect(mockCredentials).not.toHaveBeenCalled();
  expect(mockNative.open).not.toHaveBeenCalled();
  alert.mockRestore();
  appSubscription.mockRestore();
});

it.each(['session', 'model'] as const)(
  'clears transcript and rejects late callbacks when %s ownership changes',
  async change => {
    jest.clearAllMocks();
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'active',
    });
    const appSubscription = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation(() => ({ remove: jest.fn() }));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const snapshot = { activeId: 1, sessions: [{ id: 1 }, { id: 2 }] };
    const store = {
      getSnapshot: () => snapshot,
      photoDrafts: { get: () => ({ status: 'empty' }) },
    } as unknown as ConversationSessions;
    const props = {
      model: 'gpt-realtime-2.1',
      store,
      sessionId: 1,
      busy: false,
      photoPending: false,
      selectionRevision: 0,
      resolveSelectedAi: jest.fn(),
      onSend: jest.fn(),
    };
    const view = await render(<RealtimeConversationVoiceEntry {...props} />);
    await fireEvent.press(
      screen.getByRole('button', { name: '음성 대화 시작' }),
    );
    await waitFor(() => expect(mockNative.open).toHaveBeenCalledTimes(1));
    const old = realtimeEvents.transcript;
    const callId = mockNative.open.mock.calls[0][0];
    await act(() =>
      old({
        callId,
        itemId: 'old',
        role: 'user',
        text: 'synthetic old transcript',
      }),
    );
    expect(screen.getByText(/synthetic old transcript/)).toBeTruthy();
    if (change === 'session') snapshot.activeId = 2;
    await view.rerender(
      <RealtimeConversationVoiceEntry
        {...props}
        sessionId={change === 'session' ? 2 : 1}
        model={change === 'model' ? 'gpt-realtime-2.1-mini' : props.model}
      />,
    );
    await act(() =>
      old({
        callId,
        itemId: 'late',
        role: 'assistant',
        text: 'synthetic late transcript',
      }),
    );
    expect(screen.queryByText(/synthetic old transcript/)).toBeNull();
    expect(screen.queryByText(/synthetic late transcript/)).toBeNull();
    expect(screen.getByRole('button', { name: '음성 대화 시작' })).toBeTruthy();
    alert.mockRestore();
    appSubscription.mockRestore();
  },
);
