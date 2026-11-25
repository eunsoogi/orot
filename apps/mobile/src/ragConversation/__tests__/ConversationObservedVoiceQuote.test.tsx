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

jest.mock('../../assistantAppearance/AssistantAppearanceProvider', () => ({
  useAssistantAppearance: () => ({ value: { name: '테스트 비서' } }),
}));

test('an ended call shows literal Korean speech turns only once after expansion', async () => {
  const app = jest.spyOn(AppState, 'addEventListener').mockReturnValue({
    remove: jest.fn(),
  });
  const previous = AppState.currentState;
  AppState.currentState = 'active';
  try {
    const read = jest.fn(async () => ({
      source: 'live_observed_captions' as const,
      coverage: 'observed_incomplete' as const,
      usage: 'quoted_fragments_only' as const,
      lines: [
        { order: 1, role: 'assistant' as const, text: '안' },
        { order: 2, role: 'assistant' as const, text: '녕' },
        { order: 3, role: 'assistant' as const, text: '하세요' },
        { order: 4, role: 'user' as const, text: '오늘' },
        { order: 5, role: 'user' as const, text: ' 날씨' },
        { order: 6, role: 'assistant' as const, text: '네 ' },
        { order: 7, role: 'assistant' as const, text: '네' },
      ],
    }));
    const view = await render(<ConversationObservedVoiceQuote read={read} />);
    expect(read).not.toHaveBeenCalled();
    await fireEvent.press(view.getByRole('button'));
    expect(await view.findByText('테스트 비서: 안녕하세요')).toBeTruthy();
    expect(view.getByText(/오늘 날씨/)).toBeTruthy();
    expect(view.getByText('테스트 비서: 네 네')).toBeTruthy();
    expect(view.queryByText('테스트 비서: 안')).toBeNull();
    await fireEvent.press(view.getByRole('button'));
    expect(view.queryByText('테스트 비서: 안녕하세요')).toBeNull();
  } finally {
    AppState.currentState = previous;
    app.mockRestore();
  }
});
