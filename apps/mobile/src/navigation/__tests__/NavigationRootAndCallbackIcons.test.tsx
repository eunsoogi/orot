import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';
import { BottomNavigationMenu } from '../BottomNavigationMenu';
import type { NavigationSurfaceProps } from '../NavigationActionBar';
import { RootTabActions } from '../RootTabActions';
import { navigationMoreDescriptor } from '../navigationActionDescriptor';
import { createNativeNavigationBindings } from '../nativeNavigationActions';
import { createNavigationController } from '../navigationController';
import { rootTabItems } from '../rootTabs';

function FallbackSurface({ children }: NavigationSurfaceProps) {
  return <View>{children}</View>;
}

test('root actions have only glyphs while descriptor names and current selection stay available', async () => {
  const controller = createNavigationController<'home'>('home');
  controller.registerLeaveGuard(
    controller.getSnapshot().currentRoute.key,
    async () => true,
  );
  const onSelect = jest.fn();
  const rootTabs = { activeTab: 'overview' as const, onSelect };
  const { actions } = createNativeNavigationBindings({
    controller,
    snapshot: controller.getSnapshot(),
    rootTabs,
    backDisabled: false,
  });
  expect(actions.every(item => !item.showsTitleWithSystemImage)).toBe(true);
  expect(navigationMoreDescriptor(true).showsTitleWithSystemImage).not.toBe(
    true,
  );
  const view = await render(
    <RootTabActions
      controller={controller}
      rootTabs={rootTabs}
      disabled={false}
    />,
  );
  for (const item of rootTabItems) {
    const button = screen.getByRole('button', {
      name: item.accessibilityLabel,
    });
    expect(button.props.accessibilityState.selected).toBe(
      item.id === 'overview',
    );
    expect(screen.queryByText(item.label)).toBeNull();
  }
  await fireEvent.press(
    screen.getByRole('button', {
      name: rootTabItems.find(x => x.id === 'records')!.accessibilityLabel,
    }),
  );
  await waitFor(() => expect(onSelect).toHaveBeenCalledWith('records'));
  await view.unmount();
});

test('standalone callback keeps one left Back and one right action, both visually unlabeled', async () => {
  const back = jest.fn();
  const primary = jest.fn();
  await render(
    <BottomNavigationMenu
      onBack={back}
      testID="c-back"
      surface={FallbackSurface}
      primaryAction={{
        label: '저장',
        accessibilityLabel: '편집 내용 저장',
        testID: 'c-save',
        onPress: primary,
        systemImageName: 'checkmark',
      }}
    />,
  );
  expect(screen.queryByText('뒤로')).toBeNull();
  expect(screen.queryByText('저장')).toBeNull();
  const row = screen.getByTestId('bottom-navigation-action-bar');
  expect(StyleSheet.flatten(row.props.style)).toMatchObject({
    flexDirection: 'row',
    justifyContent: 'space-between',
  });
  const actions = screen.getAllByRole('button');
  expect(actions.map(a => a.props.accessibilityLabel)).toEqual([
    '이전 화면으로 돌아가기',
    '편집 내용 저장',
  ]);
  await fireEvent.press(actions[0]!);
  await fireEvent.press(actions[1]!);
  expect(back).toHaveBeenCalledTimes(1);
  expect(primary).toHaveBeenCalledTimes(1);
});
