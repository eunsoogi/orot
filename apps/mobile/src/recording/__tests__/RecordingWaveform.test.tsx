import { render, screen } from '@testing-library/react-native';
import RecordingWaveform from '../RecordingWaveform';

test('renders silence honestly and uses bounded real readings for the latest bar', async () => {
  const view = await render(
    <RecordingWaveform status="recording" durationMs={100} amplitude={0} />,
  );
  expect(
    screen.getByTestId('recording-waveform-bar-44', {
      includeHiddenElements: true,
    }),
  ).toHaveStyle({
    height: 3,
  });
  await view.rerender(
    <RecordingWaveform status="recording" durationMs={200} amplitude={1} />,
  );
  expect(
    screen.getByTestId('recording-waveform-bar-44', {
      includeHiddenElements: true,
    }),
  ).toHaveStyle({
    height: 54,
  });
  expect(
    screen.getByTestId('recording-waveform-bar-43', {
      includeHiddenElements: true,
    }),
  ).toHaveStyle({
    height: 3,
  });
  await view.rerender(
    <RecordingWaveform
      status="recording"
      durationMs={300}
      amplitude={Number.NaN}
    />,
  );
  expect(
    screen.getByTestId('recording-waveform-bar-44', {
      includeHiddenElements: true,
    }),
  ).toHaveStyle({
    height: 3,
  });
});

test('freezes on interruption or pause and clears the previous session at restart', async () => {
  const view = await render(
    <RecordingWaveform status="recording" durationMs={100} amplitude={1} />,
  );
  await view.rerender(
    <RecordingWaveform status="interrupted" durationMs={100} amplitude={0} />,
  );
  expect(
    screen.getByTestId('recording-waveform-bar-44', {
      includeHiddenElements: true,
    }),
  ).toHaveStyle({
    height: 54,
    opacity: 0.4,
  });
  await view.rerender(
    <RecordingWaveform status="paused" durationMs={100} amplitude={0} />,
  );
  expect(
    screen.getByTestId('recording-waveform-bar-44', {
      includeHiddenElements: true,
    }),
  ).toHaveStyle({
    height: 54,
  });
  await view.rerender(
    <RecordingWaveform status="recording" durationMs={200} amplitude={0} />,
  );
  expect(
    screen.getByTestId('recording-waveform-bar-43', {
      includeHiddenElements: true,
    }),
  ).toHaveStyle({
    height: 54,
  });
  await view.rerender(
    <RecordingWaveform status="recording" durationMs={0} amplitude={0} />,
  );
  expect(
    screen.getByTestId('recording-waveform-bar-43', {
      includeHiddenElements: true,
    }),
  ).toHaveStyle({
    height: 3,
  });
});
