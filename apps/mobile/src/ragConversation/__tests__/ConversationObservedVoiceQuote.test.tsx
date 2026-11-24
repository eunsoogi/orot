import { act, fireEvent, render } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import {
  ConversationObservedVoiceQuote,
  type ReadObservedVoiceQuote,
} from '../ConversationObservedVoiceQuote';

test('a backgrounded or replaced explicit tap cannot reveal its delayed local quote', async () => {
  let onAppChange: ((phase: AppStateStatus) => void) | undefined;
  const app = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, listener) => {
      onAppChange = listener;
      return { remove: jest.fn() };
    });
  const old = AppState.currentState;
  AppState.currentState = 'active';
  let capturedSignal: AbortSignal | undefined;
  let release: (
    quote: Awaited<ReturnType<ReadObservedVoiceQuote>>,
  ) => void = () => {};
  const read = jest.fn((signal: AbortSignal) => {
    capturedSignal = signal;
    return new Promise<Awaited<ReturnType<ReadObservedVoiceQuote>>>(resolve => {
      release = resolve;
    });
  });
  const screen = await render(<ConversationObservedVoiceQuote read={read} />);
  try {
    expect(read).not.toHaveBeenCalled();
    await fireEvent.press(
      screen.getByRole('button', { name: '저장된 자막 보기' }),
    );
    expect(capturedSignal?.aborted).toBe(false);
    await act(async () => {
      AppState.currentState = 'background';
      onAppChange?.('background');
    });
    expect(capturedSignal?.aborted).toBe(true);
    await act(async () => {
      AppState.currentState = 'active';
      onAppChange?.('active');
      release({
        source: 'live_observed_captions',
        coverage: 'observed_incomplete',
        usage: 'quoted_fragments_only',
        lines: [{ order: 1, role: 'user', text: 'Synthetic delayed caption' }],
      });
    });
    expect(screen.queryByText(/Synthetic delayed caption/)).toBeNull();
  } finally {
    await screen.unmount();
    AppState.currentState = old;
    app.mockRestore();
  }
});
