import { fireEvent, render, screen } from '@testing-library/react-native';
import RecordingTranscriptionFeedback from '../RecordingTranscriptionFeedback';

test('explains empty automatic recognition and leaves retry available', async () => {
  const onRetry = jest.fn();
  await render(
    <RecordingTranscriptionFeedback
      snapshot={{
        sourceId: 'saved-audio',
        status: 'failed',
        failureReason: 'NO_RECOGNIZED_SPEECH',
      }}
      onRetry={onRetry}
    />,
  );
  expect(
    screen.getByText(
      '인식된 말이 없어요. 녹음을 들어 소리가 담겼는지 확인한 뒤 다시 시도해 주세요.',
    ),
  ).toBeVisible();
  await fireEvent.press(screen.getByTestId('recording-transcription-retry'));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

test('does not expose an unknown automatic failure reason', async () => {
  await render(
    <RecordingTranscriptionFeedback
      snapshot={{
        sourceId: 'saved-audio',
        status: 'failed',
        failureReason: 'private native detail',
      }}
      onRetry={jest.fn()}
    />,
  );
  expect(screen.queryByText(/private native detail/)).toBeNull();
  expect(screen.getByTestId('recording-transcription-retry')).toBeEnabled();
});
