import { render, screen } from '@testing-library/react-native';
import { Text, View } from 'react-native';
import type { NavigationSurfaceProps } from '../NavigationActionBar';
import { NavigationActionBarPresentation } from '../NavigationActionBarPresentation';
import { NavigationRootLayoutContext } from '../navigationRootLayout';
import type { NavigationGlassAction } from '../NavigationGlassSurface';
import type { RightNavigationRootLayout } from '../navigationRootLayout';

const rightLayout: RightNavigationRootLayout = {
  placement: 'right',
  reservedRightWidth: 60,
  contentWidth: 940,
  windowHeight: 600,
  railTopInset: 132,
  railBottomInset: 42,
  railRightInset: 12,
  systemBottomInset: 30,
};

const rootTab: NavigationGlassAction = {
  id: 'tab-home',
  label: 'Home',
  accessibilityLabel: 'Home',
  testID: 'navigation-tab-home',
  rootTab: true,
};

/** Captures the selected presentation mode and native action list for layout behavior tests. */
function PresentationSurface({
  actions = [],
  children,
  layoutMode,
  style,
  testID,
}: NavigationSurfaceProps) {
  return (
    <View accessibilityHint={layoutMode} style={style} testID={testID}>
      <Text testID={`${testID}-actions`}>
        {actions.map(action => action.id).join(',')}
      </Text>
      {children}
    </View>
  );
}

test('uses the bottom bar when the keyboard leaves too little room for the complete rail', async () => {
  await render(
    <NavigationRootLayoutContext.Provider value={rightLayout}>
      <NavigationActionBarPresentation
        actions={[rootTab]}
        bottomActions={<View testID="bottom-navigation-actions" />}
        isDarkAppearance={false}
        keyboardHeight={200}
        keyboardVisible
        onAction={jest.fn()}
        reclaimRootTabInset={false}
        safeAreaHandledByParent
        surface={PresentationSurface}
      />
    </NavigationRootLayoutContext.Provider>,
  );

  expect(screen.queryByTestId('navigation-right-rail')).toBeNull();
  expect(
    screen.getByTestId('navigation-bar-fallback').props.accessibilityHint,
  ).toBe('bottom');
  expect(
    screen.getByTestId('navigation-bar-fallback-actions').props.children,
  ).toBe('tab-home');
});
