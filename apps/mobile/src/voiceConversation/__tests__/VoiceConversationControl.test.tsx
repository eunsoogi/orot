import { fireEvent, render, screen } from '@testing-library/react-native';
import { VoiceConversationControl } from '../VoiceConversationControl';

test('offers explicit start and keeps stop reachable during active phases', async () => {
  const onStart = jest.fn();
  const onStop = jest.fn();
  const props = {
    disabled: false,
    startLabel: '음성 대화 시작',
    stopLabel: '음성 대화 중지',
    finishLabel: '말하기 완료',
    recoverLabel: '다시 시도',
    status: '',
    onStart,
    onStop,
    onFinish: jest.fn(),
    onRecover: jest.fn(),
  };
  const view = await render(
    <VoiceConversationControl {...props} phase="idle" />,
  );
  expect(onStart).not.toHaveBeenCalled();
  expect(screen.getByTestId('voice-control-glass').props.pointerEvents).toBe(
    'none',
  );
  expect(screen.getByRole('button', { name: props.startLabel })).toHaveStyle({
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
  });
  await fireEvent.press(screen.getByRole('button', { name: props.startLabel }));
  expect(onStart).toHaveBeenCalledTimes(1);
  await view.rerender(
    <VoiceConversationControl
      {...props}
      disabled
      phase="speaking"
      status="답변을 읽고 있어요"
    />,
  );
  expect(screen.getByText('답변을 읽고 있어요')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: props.stopLabel }));
  expect(onStop).toHaveBeenCalledTimes(1);
  await view.rerender(<VoiceConversationControl {...props} phase="cleaning" />);
  expect(screen.getByRole('button', { name: props.startLabel })).toBeDisabled();
  await view.rerender(<VoiceConversationControl {...props} phase="error" />);
  await fireEvent.press(
    screen.getByRole('button', { name: props.recoverLabel }),
  );
  expect(props.onRecover).toHaveBeenCalledTimes(1);
});
