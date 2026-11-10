import { act, render } from '@testing-library/react-native';
import { ActionSheetIOS, View } from 'react-native';
import type { NavigationSurfaceProps } from '../NavigationActionBar';
import { NavigationGlassSurface } from '../NavigationGlassSurface';
import { NavigationPageActionDock } from '../NavigationPageActionDock';
import { registerNavigationTestObserver } from '../navigationTestObservation';
import type { NavigationRouteAction } from '../useNavigationPrimaryAction';

let dispatch: NavigationSurfaceProps['onAction'];
const metricsControl = globalThis as typeof globalThis & {
  __OROT_TEST_PAGE_METRICS__?: null;
};
afterEach(() => {
  delete metricsControl.__OROT_TEST_PAGE_METRICS__;
});
function Surface({ onAction, testID }: NavigationSurfaceProps) {
  dispatch = onAction;
  return <View testID={testID} />;
}

test('overflow invokes only a currently enabled action and ignores selections after route exit', async () => {
  const observe = jest.fn();
  const stopObservation = registerNavigationTestObserver(observe);
  const save = jest.fn();
  const cancel = jest.fn();
  const actions: NavigationRouteAction[] = [
    {
      id: 'save',
      label: 'Save',
      accessibilityLabel: 'Save',
      testID: 'save',
      onPress: save,
    },
    {
      id: 'cancel',
      label: 'Cancel',
      accessibilityLabel: 'Cancel',
      testID: 'cancel',
      onPress: cancel,
      disabled: true,
    },
  ];
  let select: ((index: number) => void) | undefined;
  const show = jest
    .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
    .mockImplementation((_options, callback) => {
      select = callback;
    });
  const dismiss = jest
    .spyOn(ActionSheetIOS, 'dismissActionSheet')
    .mockImplementation(() => undefined);
  const view = await render(
    <NavigationPageActionDock
      actions={actions}
      capacity={1}
      disabled={false}
      isDarkAppearance={false}
      isRail
      routeKey="first"
      surface={Surface}
      surfaceProps={{}}
    />,
  );
  await act(async () =>
    dispatch?.({ nativeEvent: { id: 'page:overflow' } } as Parameters<
      NonNullable<typeof dispatch>
    >[0]),
  );
  expect(show).toHaveBeenCalledTimes(1);
  expect(observe).toHaveBeenCalledWith(
    expect.objectContaining({ event: 'menu-handler', routeKey: 'first' }),
  );
  expect(observe).toHaveBeenCalledWith(
    expect.objectContaining({ event: 'menu-show-request', routeKey: 'first' }),
  );
  await act(async () => select?.(1));
  expect(cancel).not.toHaveBeenCalled();
  await act(async () =>
    dispatch?.({ nativeEvent: { id: 'page:overflow' } } as Parameters<
      NonNullable<typeof dispatch>
    >[0]),
  );
  await view.unmount();
  expect(dismiss).toHaveBeenCalledTimes(1);
  await act(async () => select?.(0));
  expect(save).not.toHaveBeenCalled();
  show.mockRestore();
  dismiss.mockRestore();
  stopObservation();
});

test('uses current native width measurements and ignores stale results', async () => {
  metricsControl.__OROT_TEST_PAGE_METRICS__ = null;
  const actions: NavigationRouteAction[] = ['first', 'second', 'third'].map(
    id => ({
      id,
      label: id,
      accessibilityLabel: id,
      testID: id,
      onPress: jest.fn(),
    }),
  );
  const view = await render(
    <NavigationPageActionDock
      actions={actions}
      capacity={1}
      disabled={false}
      isDarkAppearance={false}
      isRail={false}
      routeKey="route"
      surface={NavigationGlassSurface}
      surfaceProps={{}}
    />,
  );
  const native = view.getByTestId('navigation-page-action-surface');
  expect(view.getByTestId('navigation-page-action-overflow')).toBeTruthy();
  const revision = native.props.pageMetricsRequest.revision as string;
  await act(async () =>
    native.props.onPageMetrics({
      nativeEvent: { revision: 'old', width: 402, widths: [140, 130, 125, 48] },
    }),
  );
  expect(view.queryByTestId('first')).toBeNull();
  await act(async () =>
    native.props.onPageMetrics({
      nativeEvent: { revision, width: 402, widths: [140, 130, 125, 48] },
    }),
  );
  expect(view.getByTestId('first')).toBeTruthy();
  expect(view.getByTestId('second')).toBeTruthy();
  expect(view.queryByTestId('third')).toBeNull();
  expect(view.getByTestId('navigation-page-action-overflow')).toBeTruthy();
});

test('retains the page action icon and its label below on the bottom bar', async () => {
  const view = await render(
    <NavigationPageActionDock
      actions={[
        {
          id: 'save',
          label: 'Save symptom record',
          navigationLabel: 'Save',
          accessibilityLabel: 'Save symptom record',
          testID: 'save',
          systemImageName: 'checkmark',
          onPress: jest.fn(),
        },
      ]}
      capacity={1}
      disabled={false}
      isDarkAppearance={false}
      isRail={false}
      routeKey="route"
      surface={NavigationGlassSurface}
      surfaceProps={{}}
    />,
  );
  const surface = view.getByTestId('navigation-page-action-surface');
  expect(surface.props.pageMetricsRequest.actions[0]).toEqual(
    expect.objectContaining({
      systemImageName: 'checkmark',
      showsTitleWithSystemImage: true,
      titleBelowImage: true,
    }),
  );
  expect(surface.props.actions[0]).toEqual(
    expect.objectContaining({
      id: 'page:save',
      label: 'Save',
      accessibilityLabel: 'Save symptom record',
      systemImageName: 'checkmark',
      showsTitleWithSystemImage: true,
      titleBelowImage: true,
    }),
  );
});
