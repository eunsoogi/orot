import { act, fireEvent, render } from '@testing-library/react-native';
import { AppState, type AppStateStatus, ScrollView } from 'react-native';
import { ConversationHistory } from '../ConversationHistory';
import { openConversationReadingPosition } from '../openConversationReadingPosition';

jest.mock('../openConversationReadingPosition', () => ({
  openConversationReadingPosition: jest.fn(),
}));

test.each([false, true])(
  'only a completed reading-position load may start following (foreground interrupted: %s)',
  async interrupted => {
    const old = AppState.currentState;
    const changes: Array<(value: AppStateStatus) => void> = [];
    const app = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event, listener) => {
        changes.push(listener);
        return { remove: jest.fn() };
      });
    const transition = (value: AppStateStatus) => {
      AppState.currentState = value;
      for (const change of changes) change(value);
    };
    AppState.currentState = 'active';
    const scroll = jest.spyOn(ScrollView.prototype, 'scrollToEnd');
    let settle: (value: { version: number; position: null }) => void = () => {};
    const read = jest.fn(
      () =>
        new Promise<{ version: number; position: null }>(resolve => {
          settle = resolve;
        }),
    );
    jest
      .mocked(openConversationReadingPosition)
      .mockResolvedValue({ read, write: jest.fn() });
    const ui = await render(
      <ConversationHistory
        messages={[
          {
            id: -1,
            role: 'user',
            content: 'Synthetic settled question',
            restoredHistory: true,
          },
        ]}
        pendingMessage={null}
        error=""
        toolSourceSessionId="synthetic-same-session"
        sessionId={3}
        onOpenSource={jest.fn()}
        onLinkError={jest.fn()}
      />,
    );
    try {
      expect(read).toHaveBeenCalledTimes(1);
      const history = ui.getByTestId('rag-conversation-history');
      await fireEvent(history, 'contentSizeChange', 300, 1000);
      expect(scroll).not.toHaveBeenCalled();
      if (interrupted) await act(() => transition('inactive'));
      await act(() => settle({ version: 0, position: null }));
      if (interrupted) await act(() => transition('active'));
      expect(scroll).toHaveBeenCalledTimes(interrupted ? 0 : 1);

      // A settled reader, unlike a following reader, keeps native offset ownership
      // while the same transcript and window are measured again on return.
      scroll.mockClear();
      await fireEvent(history, 'scrollBeginDrag');
      await fireEvent.scroll(history, {
        nativeEvent: {
          contentOffset: { x: 0, y: 156 },
          contentSize: { width: 300, height: 1000 },
          layoutMeasurement: { width: 300, height: 480 },
        },
      });
      await fireEvent(history, 'scrollEndDrag');
      await act(() => transition('inactive'));
      await act(() => transition('background'));
      // Snapshot layout can transiently report a shorter transcript and a
      // clamped offset at its bottom. That is not new reader intent.
      await fireEvent(history, 'contentSizeChange', 300, 680);
      await fireEvent.scroll(history, {
        nativeEvent: {
          contentOffset: { x: 0, y: 200 },
          contentSize: { width: 300, height: 680 },
          layoutMeasurement: { width: 300, height: 480 },
        },
      });
      await act(() => transition('active'));
      await fireEvent(history, 'layout', {
        nativeEvent: { layout: { height: 420 } },
      });
      await fireEvent(history, 'contentSizeChange', 300, 1000);
      expect(scroll).not.toHaveBeenCalled();
      expect(ui.getByTestId('rag-conversation-history')).toBe(history);
      expect(ui.getByText('Synthetic settled question')).toBeTruthy();
    } finally {
      await ui.unmount();
      app.mockRestore();
      scroll.mockRestore();
      AppState.currentState = old;
    }
  },
);
