import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert, AppState } from 'react-native';
import { RealtimeConversationVoiceEntry } from '../RealtimeConversationVoiceEntry';
import type { ConversationVoiceProps } from '../conversationVoiceDependencies';
import type { RealtimeTranscript } from '../nativeRealtimeVoice';
import type { RealtimeToolRequest } from '../realtimeToolRequests';
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../assistantAppearance/AssistantHeader', () => ({
  AssistantHeader: () => null,
}));
jest.mock('../../voiceSettings/voiceSettingsStore', () => ({
  voiceSettingsStore: {
    realtimeCredentials: async () => ({
      model: 'gpt-realtime-2.1',
      apiKey: 'synthetic',
    }),
    subscribe: () => () => {},
  },
}));
jest.mock('../../ragConversation/entryIntentSender', () => ({
  entryIntentSender: (_store: unknown, _id: number, send: unknown) => send,
}));
let mockTranscript = (_: RealtimeTranscript) => {};
let mockTool = (_: RealtimeToolRequest) => {};
const mockNative = {
  open: jest.fn(async () => {}),
  stop: jest.fn(async () => {}),
  pause: jest.fn(async () => {}),
  resume: jest.fn(async () => {}),
  interrupt: jest.fn(async () => {}),
  onState: () => () => {},
  onInterrupted: () => () => {},
  onTranscript: (listener: typeof mockTranscript) => {
    mockTranscript = listener;
    return () => {};
  },
  tools: {
    onToolCall: (listener: typeof mockTool) => {
      mockTool = listener;
      return () => {};
    },
    onToolCancelled: () => () => {},
    cancel: jest.fn(async () => {}),
    resolveToolCall: jest.fn(async () => true),
  },
};
jest.mock('../nativeRealtimeVoice', () => ({
  nativeRealtimeVoice: () => mockNative,
}));

test.each([true, false])(
  'tool opt-in keeps exact transcript execution and separate result approval: %s',
  async approved => {
    jest.clearAllMocks();
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'active',
    });
    const events = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation(() => ({ remove: jest.fn() }));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const confirmResult = jest.fn(async () => approved);
    const send = jest.fn(() => ({
      completion: Promise.resolve({
        status: 'completed',
        answer: '합성 결과',
        identity: {},
      }),
      cancel: jest.fn(),
      readCurrentCompletion: async () => '합성 결과',
    }));
    const props = {
      store: {
        getSnapshot: () => ({
          activeId: 1,
          sessions: [{ id: 1, requestActivity: { requestId: 9 } }],
        }),
        photoDrafts: { get: () => ({ status: 'empty' }) },
        sendOwnedPrompt: send,
      },
      sessionId: 1,
      busy: false,
      photoPending: false,
      selectionRevision: 0,
      resolveSelectedAi: async () => ({
        status: 'ready',
        provider: { id: 'selected' },
        modelId: 'text-model',
        recipient: '선택 서비스',
      }),
      onSend: jest.fn(),
      confirmRealtimeResult: confirmResult,
    } as unknown as ConversationVoiceProps;
    await render(
      <RealtimeConversationVoiceEntry {...props} model="gpt-realtime-2.1" />,
    );
    await fireEvent.press(
      screen.getByRole('button', { name: '음성 대화 시작' }),
    );
    await act(async () => {
      alert.mock.calls[0][2]![2].onPress?.();
    });
    await waitFor(() => expect(mockNative.open).toHaveBeenCalled());
    const callId = (mockNative.open.mock.calls as unknown[][])[0][0] as string;
    expect((mockNative.open.mock.calls as unknown[][])[0][4]).toBe(true);
    await act(async () => {
      mockTranscript({
        callId,
        itemId: 'input',
        role: 'user',
        text: '합성 인식 원문',
      });
      mockTool({
        callId,
        responseId: 'response',
        toolCallId: 'tool',
        inputItemId: 'input',
      });
    });
    expect(send).not.toHaveBeenCalled();
    expect(screen.getAllByText('합성 인식 원문').length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByRole('button', { name: '이 요청 실행' }));
    await waitFor(() => expect(confirmResult).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(mockNative.tools.resolveToolCall).toHaveBeenCalledTimes(1),
    );
    const output = (
      mockNative.tools.resolveToolCall.mock.calls as unknown[][]
    )[0][1];
    expect(output).toBe(
      approved
        ? '{"status":"completed","answer":"합성 결과"}'
        : '{"status":"not_authorized"}',
    );
    expect(send).toHaveBeenCalledTimes(1);
    alert.mockRestore();
    events.mockRestore();
  },
);
