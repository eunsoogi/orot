import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert, AppState } from 'react-native';
import { RealtimeConversationVoiceEntry } from '../RealtimeConversationVoiceEntry';
import type { ConversationSessions } from '../../ragConversation/conversationSessionTypes';

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
const mockNative = {
  open: jest.fn(async () => {}),
  stop: jest.fn(async () => {}),
  pause: jest.fn(async () => {}),
  resume: jest.fn(async () => {}),
  interrupt: jest.fn(async () => {}),
  onState: jest.fn(() => () => {}),
  onTranscript: jest.fn(() => () => {}),
  onInterrupted: jest.fn(() => () => {}),
};
jest.mock('../nativeRealtimeVoice', () => ({
  nativeRealtimeVoice: () => mockNative,
}));

it('requires remote audio and cost consent, preserves drafts, never calls the selected text model', async () => {
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
  expect(alert).toHaveBeenCalledWith(
    'OpenAI Realtime로 통화할까요?',
    expect.stringContaining('별도 API 사용료'),
    expect.any(Array),
  );
  expect(mockNative.open).not.toHaveBeenCalled();
  expect(mockCredentials).not.toHaveBeenCalled();
  await act(async () => {
    alert.mock.calls[0][2]![1].onPress?.();
  });
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
  await fireEvent.press(screen.getByRole('button', { name: '음성 대화 시작' }));
  const accept = alert.mock.calls[0][2]![1].onPress;
  snapshot.activeId = 2;
  await view.rerender(
    <RealtimeConversationVoiceEntry {...props} sessionId={2} />,
  );
  await act(async () => {
    accept?.();
  });
  expect(mockCredentials).not.toHaveBeenCalled();
  expect(mockNative.open).not.toHaveBeenCalled();
  alert.mockRestore();
  appSubscription.mockRestore();
});
