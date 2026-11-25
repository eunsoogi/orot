jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { AppState } from 'react-native';
import { VoiceCallProbeEntry } from '../e2e/voiceCallProbeEntry';

// The actual duplex controller receives only fake ports; this does not prove microphone or OS audio behavior.
const caption = '비서: Synthetic fixture output';

test('synthetic speech interrupts automatically and End removes the transcript', async () => {
  await render(<VoiceCallProbeEntry />);
  await screen.findByText('Synthetic listening');
  await fireEvent.press(screen.getByTestId('voice-call-mute'));
  expect(screen.getByTestId('voice-call-resume')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('voice-call-resume'));
  await screen.findByText('Synthetic listening');
  await fireEvent.press(screen.getByTestId('voice-call-finish'));
  await screen.findByText('Synthetic speaking');
  expect(screen.queryByTestId('voice-call-interrupt')).toBeNull();
  const transcript = within(screen.getByTestId('voice-transcript-scroll'));
  expect(transcript.getByLabelText(caption)).toBeVisible();
  expect(transcript.getByText(caption)).toBeVisible();
  await fireEvent.press(screen.getByTestId('voice-fixture-speech-start'));
  await screen.findByText('Synthetic listening');
  expect(screen.queryByTestId('voice-fixture-speech-start')).toBeNull();
  await fireEvent.press(screen.getByTestId('voice-call-end'));
  expect(screen.getByTestId('voice-fixture-state').props.children).toBe(
    'closed',
  );
  expect(screen.queryByLabelText(caption)).toBeNull();
  expect(
    screen.queryByText('Synthetic fixture output', { exact: false }),
  ).toBeNull();
});

test('background stops the unactivated synthetic call and clears its text', async () => {
  jest.mocked(AppState.addEventListener).mockReturnValue({ remove: jest.fn() });
  await render(<VoiceCallProbeEntry />);
  await screen.findByText('Synthetic listening');
  await fireEvent.press(screen.getByTestId('voice-call-finish'));
  await screen.findByText('Synthetic speaking');
  await act(async () => {
    for (const [event, listener] of jest.mocked(AppState.addEventListener).mock
      .calls) {
      if (event === 'change') listener('background');
    }
  });
  expect(screen.queryByLabelText(caption)).toBeNull();
  expect(
    screen.queryByText('Synthetic fixture output', { exact: false }),
  ).toBeNull();
  expect(screen.getByTestId('voice-call-resume')).toBeTruthy();
});
