jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { VoiceCallProbeEntry } from '../e2e/voiceCallProbeEntry';

// The actual duplex controller receives only fake ports; this does not prove microphone or OS audio behavior.
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
  expect(screen.getByText('AI: Synthetic fixture output')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('voice-fixture-speech-start'));
  await screen.findByText('Synthetic listening');
  expect(screen.queryByTestId('voice-fixture-speech-start')).toBeNull();
  await fireEvent.press(screen.getByTestId('voice-call-end'));
  expect(screen.getByTestId('voice-fixture-state').props.children).toBe(
    'closed',
  );
  expect(screen.queryByText('AI: Synthetic fixture output')).toBeNull();
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
  expect(screen.queryByText('AI: Synthetic fixture output')).toBeNull();
  expect(screen.getByTestId('voice-call-resume')).toBeTruthy();
});
