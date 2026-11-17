import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState, ScrollView } from 'react-native';
import { ConversationHistory } from '../ConversationHistory';
import { openConversationReadingPosition } from '../openConversationReadingPosition';
import type { ConversationReadingPosition } from '../../storage/conversationReadingPositionStorage';

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
