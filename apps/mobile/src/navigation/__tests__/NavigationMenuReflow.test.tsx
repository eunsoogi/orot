import { act, render, screen } from '@testing-library/react-native';
import { ActionSheetIOS, View } from 'react-native';
import { NavigationActionBarPresentation } from '../NavigationActionBarPresentation';
import { NavigationGlassSurface } from '../NavigationGlassSurface';
import { NavigationRootLayoutContext } from '../navigationRootLayout';

const layout = {
  placement: 'right' as const,
  reservedRightWidth: 84,
  contentWidth: 382,
  windowHeight: 678,
  railTopInset: 186,
  railBottomInset: 46,
  railRightInset: 24,
  systemBottomInset: 34,
};
const actions = ['home', 'records', 'schedule', 'ai', 'settings'].map(id => ({
  id,
  label: id,
  accessibilityLabel: id,
  testID: `tab-${id}`,
  rootTab: true,
  selected: id === 'ai',
}));
const metricsControl = globalThis as typeof globalThis & {
  __OROT_TEST_PAGE_METRICS__?: null;
};

test('keeps a bottom menu and its latest callback when keyboard reflow restores the rail', async () => {
  metricsControl.__OROT_TEST_PAGE_METRICS__ = null;
  const show = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions');
  const dismiss = jest
    .spyOn(ActionSheetIOS, 'dismissActionSheet')
    .mockImplementation(() => undefined);
  let choose: ((index: number) => void) | undefined;
  show.mockImplementation((_options, callback) => {
    choose = callback;
  });
  const oldCallback = jest.fn();
  const latestCallback = jest.fn();
  const fixture = (height: number, onAction: typeof oldCallback) => (
    <NavigationRootLayoutContext.Provider value={layout}>
      <NavigationActionBarPresentation
        actions={actions}
        bottomActions={<View />}
        isDarkAppearance={false}
        keyboardHeight={height}
        keyboardVisible={height > 0}
        onAction={onAction}
        reclaimRootTabInset={false}
        safeAreaHandledByParent
        surface={NavigationGlassSurface}
        availableWidthOverride={382}
      />
    </NavigationRootLayoutContext.Provider>
  );
  try {
    const view = await render(fixture(304, oldCallback));
    const surface = screen.getByTestId('navigation-bar-native-surface', {
      includeHiddenElements: true,
    });
    await act(async () =>
      surface.props.onPageMetrics({
        nativeEvent: {
          revision: surface.props.pageMetricsRequest.revision,
          width: 382,
          widths: [100, 100, 100, 100, 100, 80],
          heights: [84, 84, 84, 84, 84, 84],
        },
      }),
    );
    const ready = screen.getByTestId('navigation-bar-native-surface');
    await act(async () =>
      ready.props.onAction({ nativeEvent: { id: 'navigation-overflow' } }),
    );
    const index = show.mock.calls[0]![0].options.indexOf('records');
    expect(index).toBeGreaterThanOrEqual(0);
    await view.rerender(fixture(0, latestCallback));
    expect(dismiss).not.toHaveBeenCalled();
    await act(async () => choose?.(index));
    expect(oldCallback).not.toHaveBeenCalled();
    expect(latestCallback).toHaveBeenCalledTimes(1);
    expect(latestCallback).toHaveBeenCalledWith(
      expect.objectContaining({ nativeEvent: { id: 'records' } }),
    );
  } finally {
    show.mockRestore();
    dismiss.mockRestore();
    delete metricsControl.__OROT_TEST_PAGE_METRICS__;
  }
});
