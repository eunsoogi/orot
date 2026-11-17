import { act, renderHook } from '@testing-library/react-native';
import type { ComponentRef } from 'react';
import { AppState, type ScrollView } from 'react-native';
import { useConversationReadingPosition } from '../useConversationReadingPosition';
import { openConversationReadingPosition } from '../openConversationReadingPosition';
import { notifyLocalDataCleared } from '../../storage/localDataClearEvents';

jest.mock('../openConversationReadingPosition', () => ({
  openConversationReadingPosition: jest.fn(),
}));
const open = jest.mocked(openConversationReadingPosition);
const position = {
  turnId: 'saved-turn',
  role: 'user' as const,
  offset: 24,
  bottom: false,
};
const messages = [
  { id: -1, role: 'user' as const, content: 'Synthetic question' },
  {
    id: -2,
    role: 'assistant' as const,
    content: 'Synthetic preserved reply',
    toolMessageId: 'saved-turn',
  },
];
function fixture() {
  const scrollTo = jest.fn();
  const read = jest.fn().mockResolvedValue({ version: 0, position });
  const write = jest.fn().mockResolvedValue(undefined);
  open.mockResolvedValue({ read, write });
  const input = {
    sessionId: 'saved-session',
    messages,
    history: {
      current: { scrollTo } as unknown as ComponentRef<typeof ScrollView>,
    },
    followsBottom: { current: true },
    expectedOffset: { current: null as number | null },
    geometry: { current: { offset: 74 } },
  };
  return { input, read, write, scrollTo };
}
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(AppState, 'currentState', {
    value: 'active',
    configurable: true,
  });
});

test('restores a durable user row after new display IDs and layout, without sending anything', async () => {
  const f = fixture();
  const h = await renderHook(() => useConversationReadingPosition(f.input));
  expect(h.result.current.pending).toBe(true);
  await act(() => {
    h.result.current.container(10);
    h.result.current.row(-1, 40, 100);
  });
  expect(f.scrollTo).toHaveBeenLastCalledWith({ y: 74, animated: false });
  expect(f.input.followsBottom.current).toBe(false);
  expect(h.result.current.pending).toBe(false);
  expect(f.write).not.toHaveBeenCalled();
});
test('saving stores a stable turn and row-relative coordinate, not text or display ids', async () => {
  const f = fixture();
  f.read.mockResolvedValue({ version: 3, position: null });
  const h = await renderHook(() => useConversationReadingPosition(f.input));
  await act(() => {
    h.result.current.container(10);
    h.result.current.row(-1, 40, 100);
    h.result.current.cancel();
    h.result.current.save();
  });
  expect(f.write).toHaveBeenCalledWith(
    'saved-session',
    3,
    { ...position, bottom: true },
    expect.any(Function),
  );
  expect(JSON.stringify(f.write.mock.calls)).not.toContain('Synthetic');
});
test.each(['drag', 'focus', 'delete', 'session'] as const)(
  'late storage read cannot override %s ownership',
  async mode => {
    const f = fixture();
    let finish!: (value: unknown) => void;
    f.read.mockReturnValue(
      new Promise(resolve => {
        finish = resolve;
      }),
    );
    const h = await renderHook(
      (props: Parameters<typeof useConversationReadingPosition>[0]) =>
        useConversationReadingPosition(props),
      {
        initialProps: { ...f.input, focused: false },
      },
    );
    if (mode === 'drag') await act(() => h.result.current.cancel());
    if (mode === 'focus') await h.rerender({ ...f.input, focused: true });
    if (mode === 'delete') await act(() => notifyLocalDataCleared());
    if (mode === 'session') {
      f.read.mockResolvedValue({ version: 1, position: null });
      await h.rerender({
        ...f.input,
        sessionId: 'new-session',
        focused: false,
      });
    }
    await act(() => finish({ version: 0, position }));
    await act(() => {
      h.result.current.container(10);
      h.result.current.row(-1, 40, 100);
    });
    expect(f.scrollTo).not.toHaveBeenCalled();
  },
);
test('protected restoration delays the position read and a missing retained target ends restoration', async () => {
  const f = fixture();
  const h = await renderHook(
    (props: Parameters<typeof useConversationReadingPosition>[0]) =>
      useConversationReadingPosition(props),
    {
      initialProps: { ...f.input, blocked: true, hasMore: true },
    },
  );
  expect(f.read).not.toHaveBeenCalled();
  await h.rerender({ ...f.input, messages: [], blocked: false, hasMore: true });
  expect(h.result.current.targetId).toBe('saved-turn');
  await h.rerender({
    ...f.input,
    messages: [],
    blocked: false,
    hasMore: false,
  });
  expect(h.result.current.pending).toBe(false);
  expect(f.scrollTo).not.toHaveBeenCalled();
});
test('a bottom reader retains bottom following instead of an old anchor', async () => {
  const f = fixture();
  f.read.mockResolvedValue({
    version: 0,
    position: { ...position, bottom: true },
  });
  const h = await renderHook(() => useConversationReadingPosition(f.input));
  await act(() => {
    h.result.current.container(10);
    h.result.current.row(-1, 40, 100);
  });
  expect(h.result.current.pending).toBe(false);
  expect(f.input.followsBottom.current).toBe(true);
  expect(h.result.current.targetId).toBeUndefined();
  expect(f.scrollTo).not.toHaveBeenCalled();
});

test('deletion during read releases pending restoration and reads a fresh generation for later gestures', async () => {
  const f = fixture();
  let finish!: (value: unknown) => void;
  f.read
    .mockReturnValueOnce(
      new Promise(resolve => {
        finish = resolve;
      }),
    )
    .mockResolvedValue({ version: 4, position: null });
  const h = await renderHook(() => useConversationReadingPosition(f.input));
  await act(() => notifyLocalDataCleared());
  expect(h.result.current.pending).toBe(false);
  await act(() => finish({ version: 0, position }));
  await act(() => {
    h.result.current.container(10);
    h.result.current.row(-1, 40, 100);
    h.result.current.save();
  });
  expect(f.scrollTo).not.toHaveBeenCalled();
  expect(f.write).toHaveBeenLastCalledWith(
    'saved-session',
    4,
    expect.anything(),
    expect.any(Function),
  );
});
test('failed older page releases restoration without reading further or changing the current view', async () => {
  const f = fixture();
  const h = await renderHook(
    (props: Parameters<typeof useConversationReadingPosition>[0]) =>
      useConversationReadingPosition(props),
    {
      initialProps: { ...f.input, messages: [], hasMore: true, failed: false },
    },
  );
  expect(h.result.current.pending).toBe(true);
  await h.rerender({ ...f.input, messages: [], hasMore: true, failed: true });
  expect(h.result.current.pending).toBe(false);
  expect(h.result.current.targetId).toBeUndefined();
  expect(f.scrollTo).not.toHaveBeenCalled();
});
test('explicit latest and top actions persist intent without treating layout events as scrolls', async () => {
  const f = fixture();
  f.read.mockResolvedValue({ version: 0, position: null });
  const h = await renderHook(() => useConversationReadingPosition(f.input));
  await act(() => {
    h.result.current.container(10);
    h.result.current.row(-1, 40, 100);
  });
  expect(f.write).not.toHaveBeenCalled();
  await act(() => h.result.current.save({ bottom: true }));
  expect(f.write).toHaveBeenLastCalledWith(
    'saved-session',
    0,
    expect.objectContaining({ bottom: true }),
    expect.any(Function),
  );
  await act(() => h.result.current.save({ offset: 0, bottom: false }));
  expect(f.write).toHaveBeenLastCalledWith(
    'saved-session',
    0,
    expect.objectContaining({ offset: 0, bottom: false }),
    expect.any(Function),
  );
});

test('a newly submitted user turn retires the old reading anchor and persists bottom intent', async () => {
  const f = fixture();
  const h = await renderHook(
    (props: Parameters<typeof useConversationReadingPosition>[0]) =>
      useConversationReadingPosition(props),
    { initialProps: f.input },
  );
  await act(() => {
    h.result.current.container(10);
    h.result.current.row(-1, 40, 100);
  });
  await h.rerender({
    ...f.input,
    messages: [
      ...messages,
      { id: 10, role: 'user', content: 'Synthetic new question' },
    ],
  });
  expect(h.result.current.targetId).toBeUndefined();
  expect(f.write).toHaveBeenLastCalledWith(
    'saved-session',
    0,
    expect.objectContaining({ bottom: true }),
    expect.any(Function),
  );
});
