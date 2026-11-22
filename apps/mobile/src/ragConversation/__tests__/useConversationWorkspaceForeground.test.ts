import { useLayoutEffect } from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus, type HostInstance } from 'react-native';
import { useConversationWorkspaceBounds } from '../useConversationWorkspaceBounds';

jest.mock('../../navigation/NavigationGeometryProvider', () => ({
  useNavigationGeometry: () => null,
}));

// Native host geometry can change while suspended without a new JS onLayout event.
test('foreground remeasures the existing host and rejects pre-background callbacks', async () => {
  let state!: (value: AppStateStatus) => void;
  const remove = jest.fn();
  const subscription = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, listener) => {
      state = listener;
      return { remove };
    });
  const callbacks: ((
    x: number,
    y: number,
    width: number,
    height: number,
  ) => void)[] = [];
  try {
    const { result, unmount } = await renderHook(() =>
      useConversationWorkspaceBounds(),
    );
    result.current.ref.current = {
      measureInWindow: (callback: (typeof callbacks)[number]) =>
        callbacks.push(callback),
    } as unknown as HostInstance;
    await act(() => result.current.measure());
    await act(() => callbacks[0]!(0, 0, 390, 600));
    await act(() => result.current.measure());
    await act(() => state?.('background'));
    await act(() => result.current.measure());
    expect(callbacks).toHaveLength(2);
    await act(() => callbacks[1]!(0, 0, 390, 300));
    expect(result.current.plan.height).toBe(600);
    await act(() => state?.('active'));
    expect(callbacks).toHaveLength(3);
    await act(() => callbacks[2]!(0, 0, 867, 635));
    expect(result.current.plan.height).toBe(635);
    expect(result.current.plan.transcriptWidth).toBe(867);
    await unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  } finally {
    subscription.mockRestore();
  }
});

test.each([
  ['inactive', 'active'],
  ['active', 'background'],
] as const)(
  'uses current AppState when %s changes to %s before subscription',
  async (renderState, committedState) => {
    const initialState = AppState.currentState;
    let change!: (state: AppStateStatus) => void;
    const subscription = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event, listener) => {
        change = listener;
        return { remove: jest.fn() };
      });
    let width = 390;
    const measureInWindow = jest.fn(
      (
        callback: (x: number, y: number, width: number, height: number) => void,
      ) => callback(0, 0, width, 600),
    );
    const host = { measureInWindow } as unknown as HostInstance;
    try {
      AppState.currentState = renderState;
      const { result } = await renderHook(() => {
        const workspace = useConversationWorkspaceBounds();
        useLayoutEffect(() => {
          workspace.ref.current = host;
          // The RN singleton received the event before this hook subscribed.
          AppState.currentState = committedState;
        }, [workspace.ref]);
        return workspace;
      });

      if (committedState === 'background') {
        expect(measureInWindow).not.toHaveBeenCalled();
        await act(() => result.current.measure());
        expect(measureInWindow).not.toHaveBeenCalled();
        await act(() => {
          AppState.currentState = 'active';
          change('active');
        });
      }
      expect(measureInWindow).toHaveBeenCalledTimes(1);
      expect(result.current.plan.transcriptWidth).toBe(390);

      width = 620;
      await act(() => result.current.measure());
      expect(measureInWindow).toHaveBeenCalledTimes(2);
      expect(result.current.plan.transcriptWidth).toBe(620);
      expect(result.current.ref.current).toBe(host);
    } finally {
      AppState.currentState = initialState;
      subscription.mockRestore();
    }
  },
);
