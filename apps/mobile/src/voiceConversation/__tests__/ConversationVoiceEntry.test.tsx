import { getGenericPassword } from 'react-native-keychain';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert, AppState } from 'react-native';
import { ConversationVoiceEntry } from '../ConversationVoiceEntry';
import type { ConversationSessions } from '../../ragConversation/conversationSessionTypes';
import type { SelectedAiResolution } from '../../aiFeatures/integration/provider';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only' },
  getGenericPassword: jest.fn(async () => false),
  setGenericPassword: jest.fn(),
}));

const mockIdentity = jest.fn((_props: unknown) => null);
jest.mock('../../assistantAppearance/AssistantHeader', () => ({
  AssistantHeader: (props: unknown) => mockIdentity(props),
}));

let listening: (id: string) => void = () => {};
let finishCapture: (text: string) => void = () => {};
const mockNative = {
  start: jest.fn(
    (_id: string, _language: string) =>
      new Promise<string>(resolve => {
        finishCapture = resolve;
      }),
  ),
  finishCapture: jest.fn(),
  speak: jest.fn(async () => {}),
  stop: jest.fn(async () => {}),
  onListening: jest.fn((callback: (id: string) => void) => {
    listening = callback;
    return () => {};
  }),
  onInterrupted: jest.fn(() => () => {}),
};
jest.mock('../nativeVoiceConversation', () => ({
  nativeVoiceConversation: () => mockNative,
}));

test('explicit consent binds one voice turn while preserving the text draft', async () => {
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const handle = {
    requestIdentity: Promise.resolve(null),
    completion: Promise.resolve({
      status: 'completed' as const,
      identity: {
        requestId: 'r',
        sessionId: 's',
        sessionVersion: 1,
        messageId: 'm',
      },
      answer: '합성 답변',
    }),
    cancel: jest.fn(() => true),
  };
  const sendOwnedPrompt = jest.fn(() => handle);
  const snapshot = { activeId: 1, sessions: [{ id: 1, draft: '보존할 초안' }] };
  const store = {
    getSnapshot: () => snapshot,
    photoDrafts: { get: () => ({ status: 'empty' }) },
    sendOwnedPrompt,
  } as unknown as ConversationSessions;
  const selection = {
    status: 'ready',
    provider: { id: 'provider' },
    modelId: 'model',
    recipient: '선택한 서비스',
  } as SelectedAiResolution;
  await render(
    <ConversationVoiceEntry
      store={store}
      sessionId={1}
      busy={false}
      photoPending={false}
      selectionRevision={0}
      resolveSelectedAi={async () => selection}
      onSend={jest.fn()}
    />,
  );
  // An API model selection must never enter the local native pipeline.
  jest.mocked(getGenericPassword).mockResolvedValueOnce({
    password: JSON.stringify({
      mode: 'openai-api',
      model: 'gpt-realtime-2.1',
      apiKey: 'synthetic',
    }),
  } as never);
  await fireEvent.press(screen.getByRole('button', { name: '음성 대화 시작' }));
  await waitFor(() =>
    expect(alert).toHaveBeenCalledWith(
      'Realtime 음성 연결 미지원',
      expect.any(String),
    ),
  );
  expect(mockNative.start).not.toHaveBeenCalled();
  alert.mockClear();
  await fireEvent.press(screen.getByRole('button', { name: '음성 대화 시작' }));
  await waitFor(() => expect(alert).toHaveBeenCalled());
  expect(mockNative.start).not.toHaveBeenCalled();
  const buttons = alert.mock.calls[0][2]!;
  await act(async () => {
    buttons[1].onPress?.();
  });
  await waitFor(() => expect(mockNative.start).toHaveBeenCalledTimes(1));
  // The call reuses the stored identity component and cannot open settings mid-session.
  expect(mockIdentity).toHaveBeenCalledWith(
    expect.objectContaining({
      session: snapshot.sessions[0],
      editable: false,
      status: expect.any(String),
    }),
  );
  const turn = mockNative.start.mock.calls[0][0] as string;
  await act(async () => {
    listening(turn);
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '말하기 완료' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: '말하기 완료' }));
  expect(mockNative.finishCapture).toHaveBeenCalledWith(turn);
  await act(async () => {
    finishCapture('합성 질문');
  });
  await waitFor(() =>
    expect(mockNative.speak).toHaveBeenCalledWith(turn, '합성 답변', 'ko-KR'),
  );
  await waitFor(() => expect(mockNative.start).toHaveBeenCalledTimes(2));
  await fireEvent.press(screen.getByRole('button', { name: '음성 대화 종료' }));
  await waitFor(() => expect(mockNative.stop).toHaveBeenCalled());
  expect(sendOwnedPrompt).toHaveBeenCalledTimes(1);
  expect(snapshot.sessions[0].draft).toBe('보존할 초안');
  alert.mockRestore();
});
