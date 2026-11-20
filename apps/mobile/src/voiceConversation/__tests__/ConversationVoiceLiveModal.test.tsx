jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../voiceSettings/voiceSettingsStore', () => ({
  voiceSettingsStore: { load: jest.fn(), subscribe: () => () => {} },
}));
jest.mock('../nativeRealtimeVoice', () => ({
  nativeLiveVoice: () => ({}),
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
  jest.mocked(createRealtimeVoiceSession).mockImplementation(input => {
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
    const store = {
      getSnapshot: () => ({ activeId: 1, sessions: [{ id: 1 }] }),
      photoDrafts: { get: () => ({ status: 'empty' }) },
    } as unknown as ConversationVoiceProps['store'];
    await render(
      <ConversationVoiceEntry
        sessionId={1}
        busy={false}
        photoPending={false}
        selectionRevision={0}
        store={store}
        resolveSelectedAi={jest.fn()}
        onSend={jest.fn()}
      />,
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
  } finally {
    AppState.currentState = previous;
  }
});
