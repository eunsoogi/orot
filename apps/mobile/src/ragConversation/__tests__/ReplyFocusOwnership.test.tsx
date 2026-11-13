import { act, renderHook } from '@testing-library/react-native';
import { useRef } from 'react';
import type { ComponentRef } from 'react';
import { AppState } from 'react-native';
import type { AppStateStatus, ScrollView } from 'react-native';
import {
  replyFocus,
  useReplyFocusForSession,
} from '../../replyNotifications/replyFocus';
import { useReplyScroll } from '../useReplyScroll';

function useTranscript(
  isCurrent: () => boolean,
  scroll: { scrollTo: jest.Mock } | null,
) {
  const focus = useReplyFocusForSession(7, isCurrent);
  const history = useRef(
    scroll as unknown as ComponentRef<typeof ScrollView> | null,
  );
  history.current = scroll as unknown as ComponentRef<typeof ScrollView> | null;
  const followsBottom = useRef(true);
  const expectedOffset = useRef<number | null>(null);
  const layout = useReplyScroll({
    history,
    focus,
    followsBottom,
    expectedOffset,
  });
  return { focus, layout, followsBottom, expectedOffset };
}

afterEach(() => {
  const target = replyFocus.get();
  if (target) replyFocus.clear(target);
});

test('only the active retained transcript can reveal and consume a shared session target', async () => {
  let active = 'visible';
  const hiddenScroll = { scrollTo: jest.fn() };
  const visibleScroll = { scrollTo: jest.fn() };
  const hidden = await renderHook(() =>
    useTranscript(() => active === 'hidden', hiddenScroll),
  );
  const visible = await renderHook(() =>
    useTranscript(() => active === 'visible', visibleScroll),
  );
  await act(() => replyFocus.set({ sessionId: 7, messageId: 'answer' }));
  const hiddenLayout = hidden.result.current.layout;
  const visibleLayout = visible.result.current.layout;
  await act(() => {
    hiddenLayout.container(20);
    hiddenLayout.message(30);
  });
  expect(hiddenScroll.scrollTo).not.toHaveBeenCalled();
  expect(replyFocus.get()?.messageId).toBe('answer');
  await act(() => {
    visibleLayout.container(100);
    visibleLayout.message(40);
  });
  expect(visibleScroll.scrollTo).toHaveBeenCalledTimes(1);
  expect(visibleScroll.scrollTo).toHaveBeenCalledWith({
    y: 140,
    animated: false,
  });
  expect(replyFocus.get()).toBeNull();
  active = 'hidden';
  await act(() => {
    hiddenLayout.message(31);
    visibleLayout.message(41);
  });
  expect(hiddenScroll.scrollTo).not.toHaveBeenCalled();
  expect(visibleScroll.scrollTo).toHaveBeenCalledTimes(1);
});

test('captured callbacks fail closed after a route change or a new generation', async () => {
  let current = true;
  const scroll = { scrollTo: jest.fn() };
  const view = await renderHook(() => useTranscript(() => current, scroll));
  await act(() => replyFocus.set({ sessionId: 7, messageId: 'answer' }));
  const first = view.result.current;
  await act(() => first.layout.container(100));
  current = false;
  await act(() => first.layout.message(20));
  expect(scroll.scrollTo).not.toHaveBeenCalled();
  expect(first.focus?.complete()).toBe(false);
  current = true;
  await act(() => replyFocus.set({ sessionId: 7, messageId: 'answer' }));
  const second = view.result.current;
  expect(second.focus?.generation).not.toBe(first.focus?.generation);
  await act(() => {
    first.layout.container(500);
    first.layout.message(500);
  });
  expect(first.focus?.complete()).toBe(false);
  expect(replyFocus.get()?.generation).toBe(second.focus?.generation);
  await act(() => second.layout.message(25));
  expect(scroll.scrollTo).toHaveBeenCalledWith({ y: 125, animated: false });
  expect(scroll.scrollTo).toHaveBeenCalledTimes(1);
});

test('a missing scroll ref or route authority never consumes focus', async () => {
  const view = await renderHook(() => useTranscript(() => true, null));
  const unauthorized = await renderHook(() => useReplyFocusForSession(7));
  await act(() => replyFocus.set({ sessionId: 7, messageId: 'answer' }));
  await act(() => {
    view.result.current.layout.container(10);
    view.result.current.layout.message(20);
  });
  expect(replyFocus.get()?.messageId).toBe('answer');
  expect(view.result.current.followsBottom.current).toBe(true);
  expect(view.result.current.expectedOffset.current).toBeNull();
  expect(unauthorized.result.current?.canReveal()).toBe(false);
  expect(unauthorized.result.current?.complete()).toBe(false);
});

test('foreground resumes the already laid out target without another layout event', async () => {
  let resume: (state: AppStateStatus) => void = () => {};
  const subscription = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_type, listener) => {
      resume = listener;
      return { remove: jest.fn() };
    });
  let current = false;
  const scroll = { scrollTo: jest.fn() };
  const view = await renderHook(() => useTranscript(() => current, scroll));
  try {
    await act(() => replyFocus.set({ sessionId: 7, messageId: 'answer' }));
    await act(() => {
      view.result.current.layout.container(100);
      view.result.current.layout.message(25);
    });
    expect(scroll.scrollTo).not.toHaveBeenCalled();
    expect(replyFocus.get()?.messageId).toBe('answer');
    current = true;
    await act(() => resume('active'));
    expect(scroll.scrollTo).toHaveBeenCalledTimes(1);
    expect(scroll.scrollTo).toHaveBeenCalledWith({ y: 125, animated: false });
    expect(replyFocus.get()).toBeNull();
    await act(() => resume('active'));
    expect(scroll.scrollTo).toHaveBeenCalledTimes(1);
  } finally {
    view.unmount();
    subscription.mockRestore();
  }
});

test('a stale foreground callback cannot reveal a newer generation', async () => {
  const callbacks: Array<(state: AppStateStatus) => void> = [];
  const subscription = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_type, listener) => {
      callbacks.push(listener);
      return { remove: jest.fn() };
    });
  let current = false;
  const scroll = { scrollTo: jest.fn() };
  const view = await renderHook(() => useTranscript(() => current, scroll));
  try {
    await act(() => replyFocus.set({ sessionId: 7, messageId: 'answer' }));
    await act(() => {
      view.result.current.layout.container(100);
      view.result.current.layout.message(20);
    });
    const stale = callbacks[callbacks.length - 1]!;
    await act(() => replyFocus.set({ sessionId: 7, messageId: 'answer' }));
    const generation = view.result.current.focus?.generation;
    current = true;
    await act(() => stale('active'));
    expect(scroll.scrollTo).not.toHaveBeenCalled();
    expect(replyFocus.get()?.generation).toBe(generation);
    await act(() => view.result.current.layout.message(30));
    expect(scroll.scrollTo).toHaveBeenCalledTimes(1);
  } finally {
    view.unmount();
    subscription.mockRestore();
  }
});
