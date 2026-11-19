import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState, ScrollView } from 'react-native';
import { ConversationHistory } from '../ConversationHistory';
import { openConversationReadingPosition } from '../openConversationReadingPosition';
import { notifyLocalSourceDeleted } from '../../storage/localDataClearEvents';
import type { ConversationReadingPosition } from '../../storage/conversationReadingPositionStorage';
import type { DisplayMessage } from '../conversationDisplayMessage';
import * as diagnostics from '../../providers/diagnostics';

jest.mock('../openConversationReadingPosition', () => ({
  openConversationReadingPosition: jest.fn(),
}));
jest.mock('../../layout/GlassIconButton', () => ({
  GlassIconButton: require('react-native').Pressable,
}));
const open = jest.mocked(openConversationReadingPosition);
const messages = [
  { id: -1, role: 'user' as const, content: 'Synthetic restored question' },
  {
    id: -2,
    role: 'assistant' as const,
    content: 'Synthetic retained partial content',
    completion: 'partial' as const,
    toolMessageId: 'turn',
  },
];
const props = {
  messages,
  pendingMessage: null,
  error: '',
  toolSourceSessionId: 'session',
  onOpenSource: jest.fn(),
  onLinkError: jest.fn(),
};
const history = () => screen.getByTestId('rag-conversation-history');
async function layout() {
  await fireEvent(history(), 'layout', {
    nativeEvent: { layout: { height: 400 } },
  });
  await fireEvent(history(), 'contentSizeChange', 300, 1000);
  await fireEvent(
    screen.getByTestId('conversation-message-container'),
    'layout',
    { nativeEvent: { layout: { y: 10 } } },
  );
  const rows = screen.getAllByTestId(/^conversation-reading-row-/);
  for (let i = 0; i < rows.length; i++)
    await fireEvent(rows[i]!, 'layout', {
      nativeEvent: { layout: { y: 40 + i * 200, height: 200 } },
    });
}
beforeEach(() => {
  Object.defineProperty(AppState, 'currentState', {
    value: 'active',
    configurable: true,
  });
});
afterEach(() => jest.restoreAllMocks());

test('samples a validated restored row once after layout without sending its contents', async () => {
  open.mockResolvedValue({
    read: jest.fn(async () => null),
    write: jest.fn(),
  });
  const report = jest.spyOn(diagnostics, 'providerDiagnostic');
  const restored: readonly DisplayMessage[] = [
    { ...messages[0]!, restoredHistory: true, historyUnavailable: true },
    { ...messages[1]!, restoredHistory: true },
  ];
  const view = await render(
    <ConversationHistory {...props} messages={restored} restoring />,
  );
  await layout();
  expect(report).not.toHaveBeenCalled();
  await view.rerender(<ConversationHistory {...props} messages={restored} />);
  const rows = screen.getAllByTestId(/^conversation-reading-row-/);
  const frame = { nativeEvent: { layout: { y: 40, height: 200 } } };
  await fireEvent(rows[0]!, 'layout', frame);
  expect(report).not.toHaveBeenCalled();
  await fireEvent(rows[1]!, 'layout', frame);
  await fireEvent(rows[1]!, 'layout', frame);
  expect(report.mock.calls).toEqual([
    ['rag', 'history_transcript_layout', 'completed'],
  ]);
});

test('reopened history restores the read row and preserves actual partial content without a duplicate notice', async () => {
  let position: ConversationReadingPosition | null = null;
  const write = jest.fn(async (_id, _version, value) => {
    position = value;
  });
  open.mockResolvedValue({
    read: jest.fn(async () => ({ version: 0, position })),
    write,
  });
  const move = jest.spyOn(ScrollView.prototype, 'scrollTo');
  const first = await render(<ConversationHistory {...props} />);
  await layout();
  await fireEvent(history(), 'scrollBeginDrag');
  await fireEvent.scroll(history(), {
    nativeEvent: {
      contentOffset: { x: 0, y: 74 },
      contentSize: { width: 300, height: 1000 },
      layoutMeasurement: { width: 300, height: 400 },
    },
  });
  await fireEvent(history(), 'scrollEndDrag');
  expect(position).toEqual({
    turnId: 'turn',
    role: 'user',
    offset: 24,
    bottom: false,
  });
  await first.unmount();
  move.mockClear();
  await render(
    <ConversationHistory
      {...props}
      messages={messages.map(m => ({ ...m, id: m.id - 20 }))}
    />,
  );
  await layout();
  expect(move).toHaveBeenLastCalledWith({ y: 74, animated: false });
  expect(screen.getByText('Synthetic retained partial content')).toBeTruthy();
  expect(screen.queryByText('일부만 생성되어 저장된 답변이에요.')).toBeNull();
  expect(write).toHaveBeenCalledTimes(1);
});
test('a saved older row requests history once then yields to explicit user dragging', async () => {
  open.mockResolvedValue({
    read: jest.fn(async () => ({
      version: 0,
      position: {
        turnId: 'older',
        role: 'user' as const,
        offset: 8,
        bottom: false,
      },
    })),
    write: jest.fn(),
  });
  let finish!: () => void;
  const load = jest.fn(
    () =>
      new Promise<void>(resolve => {
        finish = resolve;
      }),
  );
  const r = await render(
    <ConversationHistory {...props} historyHasMore onLoadOlderHistory={load} />,
  );
  expect(load).toHaveBeenCalledTimes(1);
  await fireEvent(history(), 'scrollBeginDrag');
  await act(() => finish());
  await r.rerender(
    <ConversationHistory {...props} historyHasMore onLoadOlderHistory={load} />,
  );
  expect(load).toHaveBeenCalledTimes(1);
});

test('an unrelated source deletion reacquires the lease without requiring unchanged rows to relayout', async () => {
  const read = jest
    .fn()
    .mockResolvedValueOnce({ version: 0, position: null })
    .mockResolvedValue({ version: 2, position: null });
  const write = jest.fn();
  open.mockResolvedValue({ read, write });
  await render(<ConversationHistory {...props} />);
  await layout();
  await act(() => notifyLocalSourceDeleted());
  // Native layout is unchanged: deliberately do not fire container or row layouts again.
  await fireEvent(history(), 'scrollBeginDrag');
  await fireEvent.scroll(history(), {
    nativeEvent: {
      contentOffset: { y: 74 },
      contentSize: { height: 1000 },
      layoutMeasurement: { height: 400 },
    },
  });
  await fireEvent(history(), 'scrollEndDrag');
  expect(write).toHaveBeenLastCalledWith(
    'session',
    2,
    expect.objectContaining({ turnId: 'turn', offset: 24 }),
    expect.any(Function),
  );
});
