import { Alert } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ConversationVoiceEntry } from '../ConversationVoiceEntry';
import { voiceSettingsStore } from '../../voiceSettings/voiceSettingsStore';
import type { ConversationVoiceProps } from '../conversationVoiceDependencies';

jest.mock('../../voiceSettings/voiceSettingsStore', () => ({
  voiceSettingsStore: { load: jest.fn(), subscribe: () => () => {} },
}));
jest.mock('../LocalConversationVoiceEntry', () => {
  const { Text } = jest.requireActual(
    'react-native',
  ) as typeof import('react-native');
  return { LocalConversationVoiceEntry: () => <Text>Synthetic Apple</Text> };
});
jest.mock('../LiveConversationVoiceEntry', () => {
  const { Text } = jest.requireActual(
    'react-native',
  ) as typeof import('react-native');
  return { LiveConversationVoiceEntry: () => <Text>Synthetic Live</Text> };
});

// The runtime/bridge and no-audio-before-grant are asserted in separate owned synthetic tests.
const props = {
  sessionId: 1,
  busy: false,
  photoPending: false,
  selectionRevision: 0,
  store: {},
  resolveSelectedAi: jest.fn(),
  onSend: jest.fn(),
} as unknown as ConversationVoiceProps;

it.each([
  ['local', 'apple-system-speech', 'Synthetic Apple'],
  ['openai-api', 'gpt-live-1.1', 'Synthetic Live'],
] as const)(
  'routes %s/%s to one explicit voice backend',
  async (mode, model, displayed) => {
    jest
      .mocked(voiceSettingsStore.load)
      .mockResolvedValue({ mode, model, hasApiKey: true });
    await render(<ConversationVoiceEntry {...props} />);
    expect(await screen.findByText(displayed)).toBeTruthy();
    if (mode === 'openai-api')
      expect(screen.queryByText('Synthetic Apple')).toBeNull();
    if (model !== 'gpt-live-1.1')
      expect(screen.queryByText('Synthetic Live')).toBeNull();
  },
);

it.each([{}, { busy: true }, { photoPending: true }])(
  'uses the original voice control without starting a legacy backend (%o)',
  async restrictions => {
    jest.mocked(voiceSettingsStore.load).mockResolvedValue({
      mode: 'openai-api',
      model: 'gpt-realtime-2.1',
      hasApiKey: true,
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    try {
      await render(<ConversationVoiceEntry {...props} {...restrictions} />);
      const button = await screen.findByTestId('conversation-voice-control');
      expect(
        screen.queryByText('음성 설정에서 GPT-Live-1.1을 선택해 주세요.'),
      ).toBeNull();
      expect(screen.queryByText('Synthetic Apple')).toBeNull();
      expect(screen.queryByText('Synthetic Live')).toBeNull();
      expect(alert).not.toHaveBeenCalled();
      await fireEvent.press(button);
      if ('busy' in restrictions || 'photoPending' in restrictions)
        expect(alert).not.toHaveBeenCalled();
      else
        expect(alert).toHaveBeenCalledWith(
          '음성 모델 변경 필요',
          '음성 설정에서 GPT-Live-1.1을 선택해 주세요.',
        );
    } finally {
      alert.mockRestore();
    }
  },
);
