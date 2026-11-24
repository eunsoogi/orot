import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, useColorScheme, View } from 'react-native';
import { AppSymbol } from '../../layout/AppSymbol';
import type { NavigationSurfaceProps } from '../NavigationActionBar';
import { NavigationActionBar } from '../NavigationActionBar';
import { createNavigationController } from '../navigationController';
import { pageActionDescriptor } from '../navigationActionDescriptor';

jest.mock('../../layout/AppSymbol', () => {
  const actual = jest.requireActual(
    '../../layout/AppSymbol',
  ) as typeof import('../../layout/AppSymbol');
  return { ...actual, AppSymbol: jest.fn(actual.AppSymbol) };
});

const mockUseColorScheme = jest.mocked(useColorScheme);
afterEach(() => mockUseColorScheme.mockReturnValue('light'));

const action = {
  id: 'open-health-data-settings',
  label: '건강 데이터 설정 열기',
  accessibilityLabel: '건강 데이터 설정 열기',
  testID: 'health-records-open-health-import',
  systemImageName: 'arrow.down',
  onPress: jest.fn(),
};

test('measured native descriptor carries the health setting symbol and accessible name without a visible title', () => {
  const value = pageActionDescriptor(action, false);
  expect(value.systemImageName).toBe(action.systemImageName);
  expect(value.accessibilityLabel).toBe(action.accessibilityLabel);
  expect(value.showsTitleWithSystemImage).not.toBe(true);
  expect(value.titleBelowImage).not.toBe(true);
});

function FallbackSurface({ children }: NavigationSurfaceProps) {
  return <View>{children}</View>;
}
test('fallback chrome preserves named Back and Health Data hit targets without visible text', async () => {
  const controller = createNavigationController<'home' | 'details'>('home');
  controller.push('details');
  await render(
    <NavigationActionBar
      controller={controller}
      surface={FallbackSurface}
      safeAreaHandledByParent
      pageActions={[action]}
    />,
  );
  expect(screen.queryByText(action.label)).toBeNull();
  expect(screen.queryByText('뒤로')).toBeNull();
  const row = screen.getByTestId('navigation-contextual-fallback-row');
  expect(StyleSheet.flatten(row.props.style)).toMatchObject({
    flexDirection: 'row',
    justifyContent: 'space-between',
  });
  expect(
    screen.getAllByRole('button').map(node => node.props.accessibilityLabel),
  ).toEqual(['이전 화면으로 돌아가기', action.accessibilityLabel]);
  const back = screen.getByRole('button', { name: '이전 화면으로 돌아가기' });
  const settings = screen.getByRole('button', {
    name: action.accessibilityLabel,
  });
  expect(StyleSheet.flatten(back.props.style).minWidth).toBeGreaterThanOrEqual(
    44,
  );
  expect(
    StyleSheet.flatten(settings.props.style).minWidth,
  ).toBeGreaterThanOrEqual(44);
  await fireEvent.press(settings);
  expect(action.onPress).toHaveBeenCalledTimes(1);
});
it('uses a light control foreground for dark system appearance', async () => {
  mockUseColorScheme.mockReturnValue('dark');
  const controller = createNavigationController<'home' | 'details'>('home');
  controller.push('details');

  await render(
    <NavigationActionBar
      controller={controller}
      safeAreaHandledByParent
      surface={FallbackSurface}
    />,
  );

  const back = screen.getByRole('button', {
    name: '이전 화면으로 돌아가기',
  });
  expect(StyleSheet.flatten(back.props.style)).toEqual(
    expect.objectContaining({ borderColor: '#ffffff', borderWidth: 1 }),
  );
  expect(
    jest.mocked(AppSymbol).mock.calls.map(([props]) => props),
  ).toContainEqual(
    expect.objectContaining({ name: 'chevron.backward', color: '#f7f8fa' }),
  );
});
