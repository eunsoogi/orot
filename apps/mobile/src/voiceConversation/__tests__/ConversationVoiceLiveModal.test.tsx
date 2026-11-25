jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../voiceSettings/voiceSettingsStore', () => ({
  voiceSettingsStore: { load: jest.fn(), subscribe: () => () => {} },
}));
jest.mock('../nativeRealtimeVoice', () => ({
  nativeLiveVoice: () => ({}),
  nativeLiveManagedTools: () => null,
}));
jest.mock('../createRealtimeSettingsPermission', () => ({
  createRealtimeSettingsPermission: () => ({
    authorize: jest.fn(async () => true),
    current: () => true,
    stop: jest.fn(),
  }),
}));
jest.mock('../realtimeVoiceSession', () => ({
  createRealtimeVoiceSession: jest.fn(),
}));

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { voiceSettingsStore } from '../../voiceSettings/voiceSettingsStore';
import { ConversationVoiceEntry } from '../ConversationVoiceEntry';
import type { ConversationVoiceProps } from '../conversationVoiceDependencies';
import { createRealtimeVoiceSession } from '../realtimeVoiceSession';

test('explicit composer start reaches the real Live modal without the discarded caption', async () => {
  jest.mocked(voiceSettingsStore.load).mockResolvedValue({
    mode: 'openai-api',
    model: 'gpt-live-1.1',
    hasApiKey: true,
  });
  const previous = AppState.currentState;
  AppState.currentState = 'active';
  const start = jest.fn();
  let updateState: Parameters<typeof createRealtimeVoiceSession>[0]['changed'];
  let caption: Parameters<typeof createRealtimeVoiceSession>[0]['transcript'];
  jest.mocked(createRealtimeVoiceSession).mockImplementation(input => {
    updateState = input.changed;
    caption = input.transcript;
    start.mockImplementation(() =>
      input.changed({ phase: 'authorizing', identity: null }),
    );
    return {
      start,
      revalidate: jest.fn(),
      isSystemCallActive: () => false,
      stop: jest.fn(),
      dispose: jest.fn(),
    } as unknown as ReturnType<typeof createRealtimeVoiceSession>;
  });
  try {
    const snapshot = { activeId: 1, sessions: [{ id: 1 }, { id: 2 }] };
    const store = {
      getSnapshot: () => snapshot,
      photoDrafts: { get: () => ({ status: 'empty' }) },
    } as unknown as ConversationVoiceProps['store'];
    const props = {
      busy: false,
      photoPending: false,
      selectionRevision: 0,
      store,
      resolveSelectedAi: jest.fn(),
      onSend: jest.fn(),
    };
    const view = await render(
      <ConversationVoiceEntry sessionId={1} {...props} />,
    );
    const control = await screen.findByTestId('conversation-voice-control');
    expect(start).not.toHaveBeenCalled();
    await act(async () => {
      await fireEvent.press(control);
    });
    expect(start).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('실시간 음성 대화')).toBeTruthy();
    expect(screen.getByTestId('voice-call-end')).toBeTruthy();
    expect(screen.queryByText(/API 음성 처리|기존 기록 미전송/)).toBeNull();
    const firstCaption = caption!;
    const callId = 'live-1000-1';
    await act(async () => {
      updateState({
        phase: 'listening',
        identity: { sessionId: 1, providerId: 'openai-live', turnId: callId },
      });
      firstCaption({ callId, itemId: '1', role: 'user', text: '합성 질문' });
      firstCaption({
        callId,
        itemId: '2',
        role: 'assistant',
        text: '합성 응답',
      });
      firstCaption({
        callId: 'live-999-9',
        itemId: '2',
        role: 'assistant',
        text: '다른 통화',
      });
    });
    expect(screen.getByText('나: 합성 질문')).toBeTruthy();
    expect(screen.getByText('비서: 합성 응답')).toBeTruthy();
    expect(screen.queryByText(/다른 통화/)).toBeNull();
    expect(screen.queryByTestId('voice-call-finish')).toBeNull();
    expect(screen.queryByText(/완료를 눌러/)).toBeNull();
    expect(
      screen.getByText('듣고 있어요. 잠시 멈추면 답변을 준비해요.'),
    ).toBeTruthy();
    snapshot.activeId = 2;
    await view.rerender(<ConversationVoiceEntry sessionId={2} {...props} />);
    await act(() =>
      firstCaption({
        callId,
        itemId: '3',
        role: 'assistant',
        text: '이전 통화',
      }),
    );
    expect(screen.queryByText(/합성 질문|합성 응답|이전 통화/)).toBeNull();
  } finally {
    AppState.currentState = previous;
  }
});
