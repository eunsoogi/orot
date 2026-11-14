jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
import { fireEvent, render, screen } from '@testing-library/react-native';
import { VoiceConversationScreen } from '../VoiceConversationScreen';

const callbacks = () => ({
  onEnd: jest.fn(),
  onMute: jest.fn(),
  onResume: jest.fn(),
  onInterrupt: jest.fn(),
  onFinish: jest.fn(),
});

/** UI-only sessions never request audio; lifecycle actions remain explicit callbacks. */
test('realtime shows its actual model and does not offer manual finish', async () => {
  const actions = callbacks();
  await render(
    <VoiceConversationScreen
      visible
      phase="listening"
      status="듣고 있어요"
      manualFinish={false}
      pipeline="OpenAI selected-model API 음성 처리"
      {...actions}
    />,
  );
  expect(screen.getByText('실시간 음성 대화')).toBeTruthy();
  expect(screen.getByText('OpenAI selected-model API 음성 처리')).toBeTruthy();
  expect(screen.queryByTestId('voice-call-finish')).toBeNull();
  expect(actions.onMute).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('voice-call-mute'));
  await fireEvent.press(screen.getByTestId('voice-call-end'));
  expect(actions.onMute).toHaveBeenCalledTimes(1);
  expect(actions.onEnd).toHaveBeenCalledTimes(1);
});

test('local mode stays distinct and stopped state offers resume without listening', async () => {
  const actions = callbacks();
  const view = await render(
    <VoiceConversationScreen
      visible
      phase="listening"
      status="듣고 있어요"
      {...actions}
    />,
  );
  expect(screen.getByText('기기 음성 대화')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('voice-call-finish'));
  expect(actions.onFinish).toHaveBeenCalledTimes(1);
  await view.rerender(
    <VoiceConversationScreen
      visible
      phase="stopped"
      status="듣고 있어요"
      {...actions}
    />,
  );
  expect(screen.queryByText('듣고 있어요')).toBeNull();
  expect(screen.queryByTestId('voice-call-mute')).toBeNull();
  await fireEvent.press(screen.getByTestId('voice-call-resume'));
  expect(actions.onResume).toHaveBeenCalledTimes(1);
});
