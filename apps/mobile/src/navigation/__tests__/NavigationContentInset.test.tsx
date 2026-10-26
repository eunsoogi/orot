import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { StyleSheet, View } from 'react-native';
import { useNavigationContentInset } from '../useNavigationContentInset';
import {
  BOTTOM_NAVIGATION_CONTENT_INSET,
  NAVIGATION_CONTENT_GAP,
} from '../navigationLayout';
import { NavigationViewport } from '../NavigationViewport';

function PageEnd() {
  const inset = useNavigationContentInset();
  return <View style={inset} testID="page-end-space" />;
}

test('leaves a readable gap above the toolbar as well as the device home area', async () => {
  await render(
    <SafeAreaInsetsContext.Provider
      value={{ top: 0, left: 0, right: 0, bottom: 34 }}
    >
      <PageEnd />
    </SafeAreaInsetsContext.Provider>,
  );
  // The bar obstruction and home indicator are separate from the readable content gap.
  expect(
    StyleSheet.flatten(screen.getByTestId('page-end-space').props.style)
      .paddingBottom,
  ).toBe(BOTTOM_NAVIGATION_CONTENT_INSET + 34 + NAVIGATION_CONTENT_GAP);
});

test('tracks the measured overlay when keyboard or larger labels change its height', async () => {
  await render(
    <NavigationViewport childHandlesSafeArea actionBar={<View />}>
      <PageEnd />
    </NavigationViewport>,
  );
  const overlay = screen.getByTestId('navigation-action-bar-overlay');
  await fireEvent(overlay, 'layout', {
    nativeEvent: { layout: { height: 160, width: 320, x: 0, y: 0 } },
  });
  expect(
    StyleSheet.flatten(screen.getByTestId('page-end-space').props.style)
      .paddingBottom,
  ).toBe(176);
  await fireEvent(overlay, 'layout', {
    nativeEvent: { layout: { height: 58, width: 320, x: 0, y: 0 } },
  });
  expect(
    StyleSheet.flatten(screen.getByTestId('page-end-space').props.style)
      .paddingBottom,
  ).toBe(74);
});
