import { act, render } from '@testing-library/react-native';
import { ActionSheetIOS, View } from 'react-native';
import type { NavigationSurfaceProps } from '../NavigationActionBar';
import { NavigationPageActionDock } from '../NavigationPageActionDock';
import type { NavigationRouteAction } from '../useNavigationPrimaryAction';

let dispatch: NavigationSurfaceProps['onAction'];
function Surface({ onAction, testID }: NavigationSurfaceProps) {
  dispatch = onAction;
  return <View testID={testID} />;
}

test('overflow invokes only a currently enabled action and ignores selections after route exit', async () => {
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
});
