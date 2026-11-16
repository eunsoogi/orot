import { useState } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useConversationHistoryTarget } from '../useConversationHistoryTarget';

test.each([true, false])(
  'explicit reply navigation loads pages until found=%s or exhausted',
  async foundAtEnd => {
    const reads = jest.fn();
    const result = await renderHook(() => {
      const [pages, setPages] = useState(0);
      useConversationHistoryTarget({
        sessionId: 1,
        focusId: 'saved-target',
        found: foundAtEnd && pages >= 2,
        hasMore: pages < 2,
        loadOlder: async signal => {
          expect(signal?.aborted).toBe(false);
          reads();
          setPages(value => value + 1);
        },
      });
      return pages;
    });
    await waitFor(() => expect(result.result.current).toBe(2));
    expect(reads).toHaveBeenCalledTimes(2);
    result.unmount();
  },
);

test('ordinary opening never drains history and changing focus aborts its explicit pending read', async () => {
  let resolve!: () => void;
  let signal!: AbortSignal;
  const read = jest.fn((current?: AbortSignal) => {
    signal = current!;
    return new Promise<void>(done => {
      resolve = done;
    });
  });
  const view = await renderHook(
    ({ focusId }: { focusId?: string }) =>
      useConversationHistoryTarget({
        sessionId: 1,
        focusId,
        found: false,
        hasMore: true,
        loadOlder: read,
      }),
    { initialProps: { focusId: undefined } },
  );
  expect(read).not.toHaveBeenCalled();
  await view.rerender({ focusId: 'older-target' });
  expect(read).toHaveBeenCalledTimes(1);
  await view.rerender({ focusId: undefined });
  expect(signal.aborted).toBe(true);
  await act(async () => resolve());
  expect(read).toHaveBeenCalledTimes(1);
});

test('failed target read does not spin or bypass the manual page retry', async () => {
  const read = jest.fn(async () => {
    throw new Error('Synthetic protected read failure');
  });
  const view = await renderHook(() =>
    useConversationHistoryTarget({
      sessionId: 1,
      focusId: 'target',
      found: false,
      hasMore: true,
      loadOlder: read,
    }),
  );
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  await act(async () => {});
  expect(read).toHaveBeenCalledTimes(1);
  await view.unmount();
});

test('same target with a new focus generation aborts the old owner and starts a fresh read', async () => {
  const signals: AbortSignal[] = [];
  const settle: (() => void)[] = [];
  const read = jest.fn((signal?: AbortSignal) => {
    signals.push(signal!);
    return new Promise<void>(resolve => settle.push(resolve));
  });
  const view = await renderHook(
    ({ generation }: { generation: number }) =>
      useConversationHistoryTarget({
        sessionId: 1,
        focusId: 'same-target',
        focusGeneration: generation,
        found: false,
        hasMore: true,
        loadOlder: read,
      }),
    { initialProps: { generation: 1 } },
  );
  expect(read).toHaveBeenCalledTimes(1);
  await view.rerender({ generation: 2 });
  expect(signals[0].aborted).toBe(true);
  expect(signals[1].aborted).toBe(false);
  expect(read).toHaveBeenCalledTimes(2);
  await act(async () => settle[0]());
  expect(read).toHaveBeenCalledTimes(2);
  await view.unmount();
  expect(signals[1].aborted).toBe(true);
  await act(async () => settle[1]());
});
