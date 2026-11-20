jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
import { fireEvent, render, screen } from '@testing-library/react-native';
import { VoiceConversationScreen } from '../VoiceConversationScreen';
import { RealtimeVoiceSurface } from '../RealtimeVoiceSurface';
import { t } from '../../i18n';

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

test('Live call omits the pipeline row without replacing it with Apple copy', async () => {
  const action = jest.fn();
  await render(
    <RealtimeVoiceSurface
      visible
      voiceVisible
      suspended={false}
      handoffBusy={false}
      state={{ phase: 'authorizing', identity: null }}
      status="연결 중"
      model="gpt-live-1.1"
      transcripts={[]}
      toolConfirmation={null}
      disabled={false}
      statusExternallyRendered={false}
      start={action}
      stop={action}
      mute={action}
      resume={action}
      returnToCall={action}
      onDismiss={action}
    />,
  );
  expect(screen.getByText('실시간 음성 대화')).toBeTruthy();
  expect(screen.getByText('연결 중')).toBeTruthy();
  expect(screen.queryByText(/API 음성 처리/)).toBeNull();
  expect(
    screen.queryByText(t('ragConversation.voice.localPipeline')),
  ).toBeNull();
  expect(screen.getByTestId('voice-call-end')).toBeTruthy();
  expect(action).not.toHaveBeenCalled();
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
  expect(
    screen.getByText(t('ragConversation.voice.localPipeline')),
  ).toBeTruthy();
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

test.each(['processing', 'speaking'] as const)(
  'does not expose a manual interrupt control while %s',
  async phase => {
    const actions = callbacks();
    await render(
      <VoiceConversationScreen
        visible
        phase={phase}
        status="진행 중"
        transcript={[{ id: 'synthetic', role: 'assistant', text: '합성 대화' }]}
        {...actions}
      />,
    );
    expect(screen.queryByTestId('voice-call-interrupt')).toBeNull();
    expect(screen.getByTestId('voice-transcript-scroll')).toBeTruthy();
    expect(screen.getByText('AI: 합성 대화')).toBeTruthy();
    expect(actions.onInterrupt).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('voice-call-end'));
    expect(actions.onEnd).toHaveBeenCalledTimes(1);
  },
);

test('older local bridges retain an explicit interruption fallback', async () => {
  const actions = callbacks();
  await render(
    <VoiceConversationScreen
      visible
      phase="speaking"
      status="합성"
      manualInterrupt
      {...actions}
    />,
  );
  await fireEvent.press(screen.getByTestId('voice-call-interrupt'));
  expect(actions.onInterrupt).toHaveBeenCalledTimes(1);
});
