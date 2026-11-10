import { act, renderHook } from '@testing-library/react-native';
import { ActionSheetIOS } from 'react-native';
import { useBottomActionMenu } from '../useBottomActionMenu';

const base = {
  id: 'history',
  label: 'History',
  accessibilityLabel: 'History',
  testID: 'history',
  onPress: jest.fn(),
};

test('selects an enabled busy action without treating busy as disabled', async () => {
  const invoke = jest.fn();
  let select: ((index: number) => void) | undefined;
  const show = jest
    .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
    .mockImplementation((_options, callback) => {
      select = callback;
    });
  try {
    const hook = await renderHook(() =>
      useBottomActionMenu({
        routeKey: 'first',
        navigation: [],
        pages: [{ ...base, busy: true, disabled: false, onPress: invoke }],
        overflowNavigationIds: [],
        overflowPageIds: ['history'],
        disabled: false,
        onNavigation: jest.fn(),
      }),
    );
    await act(async () => hook.result.current());
    expect(show.mock.calls[0]?.[0].disabledButtonIndices).not.toContain(0);
    await act(async () => select?.(0));
    expect(invoke).toHaveBeenCalledTimes(1);
    await hook.unmount();
  } finally {
    show.mockRestore();
  }
});

test('selects an enabled busy navigation action', async () => {
  const invoke = jest.fn();
  let select: ((index: number) => void) | undefined;
  const show = jest
    .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
    .mockImplementation((_options, callback) => {
      select = callback;
    });
  try {
    const hook = await renderHook(() =>
      useBottomActionMenu({
        routeKey: 'first',
        navigation: [
          {
            id: 'records',
            label: 'Records',
            accessibilityLabel: 'Records',
            testID: 'records',
            busy: true,
            disabled: false,
          },
        ],
        pages: [],
        overflowNavigationIds: ['records'],
        overflowPageIds: [],
        disabled: false,
        onNavigation: invoke,
      }),
    );
    await act(async () => hook.result.current());
    expect(show.mock.calls[0]?.[0].disabledButtonIndices).not.toContain(0);
    await act(async () => select?.(0));
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ nativeEvent: { id: 'records' } }),
    );
    await hook.unmount();
  } finally {
    show.mockRestore();
  }
});

test('an action becoming direct remains selectable using its latest callback', async () => {
  const first = jest.fn();
  const latest = jest.fn();
  let select: ((index: number) => void) | undefined;
  const show = jest
    .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
    .mockImplementation((_options, callback) => {
      select = callback;
    });
  const dismiss = jest
    .spyOn(ActionSheetIOS, 'dismissActionSheet')
    .mockImplementation(() => undefined);
  try {
    const hook = await renderHook(
      ({ direct }: { direct: boolean }) =>
        useBottomActionMenu({
          routeKey: 'first',
          navigation: [],
          pages: [{ ...base, onPress: direct ? latest : first }],
          overflowNavigationIds: [],
          overflowPageIds: direct ? [] : ['history'],
          disabled: false,
          onNavigation: jest.fn(),
        }),
      { initialProps: { direct: false } },
    );
    await act(async () => hook.result.current());
    await hook.rerender({ direct: true });
    expect(dismiss).not.toHaveBeenCalled();
    await act(async () => select?.(0));
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
    await hook.unmount();
  } finally {
    show.mockRestore();
    dismiss.mockRestore();
  }
});

test.each(['route', 'removed', 'disabled', 'busy', 'unmount'] as const)(
  'invalidates an open menu when %s changes',
  async change => {
    const invoke = jest.fn();
    const show = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions');
    const dismiss = jest
      .spyOn(ActionSheetIOS, 'dismissActionSheet')
      .mockImplementation(() => undefined);
    let select: ((index: number) => void) | undefined;
    show.mockImplementation((_options, callback) => {
      select = callback;
    });
    const options = (next: boolean) => ({
      routeKey: next && change === 'route' ? 'second' : 'first',
      navigation: [],
      pages:
        next && change === 'removed'
          ? []
          : [
              {
                ...base,
                onPress: invoke,
                disabled: next && change === 'disabled',
                busy: next && change === 'busy',
              },
            ],
      overflowNavigationIds: [],
      overflowPageIds: ['history'],
      disabled: false,
      onNavigation: jest.fn(),
    });
    try {
      const hook = await renderHook(
        ({ next }: { next: boolean }) => useBottomActionMenu(options(next)),
        { initialProps: { next: false } },
      );
      await act(async () => hook.result.current());
      if (change === 'unmount') await hook.unmount();
      else await hook.rerender({ next: true });
      expect(dismiss).toHaveBeenCalledTimes(1);
      await act(async () => select?.(0));
      expect(invoke).not.toHaveBeenCalled();
      if (change !== 'unmount') await hook.unmount();
    } finally {
      show.mockRestore();
      dismiss.mockRestore();
    }
  },
);

test('cancelled old callback cannot close or select from a newer menu', async () => {
  const invoke = jest.fn();
  const callbacks: Array<(index: number) => void> = [];
  const show = jest
    .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
    .mockImplementation((_options, callback) => {
      callbacks.push(callback);
    });
  const dismiss = jest
    .spyOn(ActionSheetIOS, 'dismissActionSheet')
    .mockImplementation(() => undefined);
  try {
    const hook = await renderHook(() =>
      useBottomActionMenu({
        routeKey: 'first',
        navigation: [],
        pages: [{ ...base, onPress: invoke }],
        overflowNavigationIds: [],
        overflowPageIds: ['history'],
        disabled: false,
        onNavigation: jest.fn(),
      }),
    );
    await act(async () => hook.result.current());
    await act(async () => callbacks[0]?.(1));
    await act(async () => hook.result.current());
    await act(async () => callbacks[0]?.(0));
    await act(async () => callbacks[1]?.(0));
    expect(invoke).toHaveBeenCalledTimes(1);
    await hook.unmount();
  } finally {
    show.mockRestore();
    dismiss.mockRestore();
  }
});
