import { render, screen } from '@testing-library/react-native';
import { ConversationVoiceEndMarker } from '../ConversationVoiceEndMarker';

test.each([
  [134, '2분 14초'],
  [0, '0분 0초'],
  [3610, '60분 10초'],
] as const)(
  'draws an action-free voice receipt for %s seconds',
  async (durationSeconds, duration) => {
    await render(
      <ConversationVoiceEndMarker
        task={{ kind: 'voice_end', durationSeconds }}
      />,
    );
    expect(screen.getByText('음성 대화 종료')).toBeTruthy();
    expect(screen.getByText(duration)).toBeTruthy();
    expect(
      screen.getByTestId('conversation-voice-end-marker').props
        .accessibilityLabel,
    ).toBe(`음성 대화 종료, ${duration}`);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  },
);
