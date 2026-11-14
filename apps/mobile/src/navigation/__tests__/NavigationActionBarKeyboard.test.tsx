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
  testID: 'navigation-tab-overview',
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

test('retains the rail identity without obscured controls when the keyboard leaves too little room for the complete rail', async () => {
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

  expect(
    screen.getByTestId('navigation-right-rail').props.accessibilityHint,
  ).toBe('right');
  expect(screen.queryByTestId('navigation-bar-fallback')).toBeNull();
  expect(screen.queryByTestId('bottom-navigation-actions')).toBeNull();
  expect(
    screen.getByTestId('navigation-right-rail-actions').props.children,
  ).toBe('navigation-overflow');
});

test('retains the rail identity without obscured controls when the keyboard leaves too little room for contextual actions', async () => {
  await render(
    <NavigationRootLayoutContext.Provider value={rightLayout}>
      <NavigationActionBarPresentation
        actions={[
          {
            id: 'back',
            label: 'Back',
            accessibilityLabel: 'Back',
            testID: 'navigation-back',
          },
          {
            id: 'home',
            label: 'Home',
            accessibilityLabel: 'Home',
            testID: 'navigation-home',
          },
        ]}
        bottomActions={<View testID="bottom-navigation-actions" />}
        isDarkAppearance={false}
        keyboardHeight={400}
        keyboardVisible
        onAction={jest.fn()}
        reclaimRootTabInset={false}
        safeAreaHandledByParent
        surface={PresentationSurface}
      />
    </NavigationRootLayoutContext.Provider>,
  );

  expect(
    screen.getByTestId('navigation-right-rail').props.accessibilityHint,
  ).toBe('right');
  expect(screen.queryByTestId('navigation-bar-fallback')).toBeNull();
  expect(screen.queryByTestId('bottom-navigation-actions')).toBeNull();
  expect(
    screen.getByTestId('navigation-right-rail-actions').props.children,
  ).toBe('');
});

test('restores actions after repeated keyboard frames while genuine window changes still adapt', async () => {
  const view = (keyboardHeight: number, layout = rightLayout) => (
    <NavigationRootLayoutContext.Provider value={layout}>
      <NavigationActionBarPresentation
        actions={[{ ...rootTab, selected: true }]}
        bottomActions={<View testID="bottom-navigation-actions" />}
        isDarkAppearance={false}
        keyboardHeight={keyboardHeight}
        keyboardVisible={keyboardHeight > 0}
        onAction={jest.fn()}
        reclaimRootTabInset={false}
        safeAreaHandledByParent
        surface={PresentationSurface}
      />
    </NavigationRootLayoutContext.Provider>
  );
  const rendered = await render(view(0));
  for (const height of [200, 300, 0, 250, 0]) {
    await rendered.rerender(view(height));
    expect(
      screen.getByTestId('navigation-right-rail').props.accessibilityHint,
    ).toBe('right');
    expect(screen.queryByTestId('bottom-navigation-actions')).toBeNull();
    expect(
      screen.getByTestId('navigation-right-rail-actions').props.children,
    ).toBe(height ? 'navigation-overflow' : 'tab-home');
  }
  await rendered.rerender(view(0, { ...rightLayout, windowHeight: 300 }));
  expect(screen.queryByTestId('navigation-right-rail')).toBeNull();
  expect(
    screen.getByTestId('navigation-bar-fallback').props.accessibilityHint,
  ).toBe('bottom');
});
