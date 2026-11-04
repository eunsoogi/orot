import { render, screen, within } from '@testing-library/react-native';
import { Text, View } from 'react-native';
import type { NavigationSurfaceProps } from '../NavigationActionBar';
import { NavigationActionBarPresentation } from '../NavigationActionBarPresentation';
import type { NavigationRouteAction } from '../useNavigationPrimaryAction';
import { createNavigationGeometrySnapshot } from '../navigationGeometry';
import type { NavigationGeometryPayload } from '../navigationGeometry';
import {
  NavigationRootLayoutContext,
  resolveNavigationRootLayout,
} from '../navigationRootLayout';
import { openGeometry } from '../__fixtures__/navigationOpenGeometry';
import { leftSplitGeometry } from '../__fixtures__/navigationSplitGeometry';

/** Exposes fallback surface ordering and measured insets without claiming native proof. */
function Surface({
  actions = [],
  children,
  layoutMode,
  railBottomInset,
  railTopInset,
  testID,
}: NavigationSurfaceProps) {
  return (
    <View accessibilityHint={layoutMode} testID={testID}>
      <Text testID={`${testID}-actions`}>
        {actions
          .map(action => `${action.id}:${action.disabled === true}`)
          .join(',')}
      </Text>
      <Text
        testID={`${testID}-vertical-insets`}
      >{`${railTopInset},${railBottomInset}`}</Text>
      {children}
    </View>
  );
}

function Fixture({
  geometry,
  pageActions,
}: {
  readonly geometry: NavigationGeometryPayload;
  readonly pageActions: readonly NavigationRouteAction[];
}) {
  const layout = resolveNavigationRootLayout(
    createNavigationGeometrySnapshot(geometry),
  );
  return (
    <NavigationRootLayoutContext.Provider value={layout}>
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
        bottomActions={<View />}
        isDarkAppearance={false}
        keyboardHeight={0}
        keyboardVisible={false}
        onAction={jest.fn()}
        pageActions={pageActions}
        reclaimRootTabInset={false}
        safeAreaHandledByParent
        surface={Surface}
      />
    </NavigationRootLayoutContext.Provider>
  );
}

test('keeps Back before conversation, summary, and record actions on both rail sides after updates', async () => {
  const action = (id: string): NavigationRouteAction => ({
    id,
    label: id,
    accessibilityLabel: id,
    testID: id,
    onPress: jest.fn(),
  });
  const initialIDs = [
    'conversation-history',
    'conversation-new-session',
    'summary-generate',
    'record-edit',
  ];
  const updatedIDs = [
    'conversation-new-session',
    'conversation-history',
    'record-edit',
    'summary-generate',
  ];
  const { rerender } = await render(
    <Fixture geometry={openGeometry} pageActions={initialIDs.map(action)} />,
  );

  const assertBackFirst = (side: 'left' | 'right', pageIDs: string[]) => {
    const navigation = screen.getByTestId('navigation-right-rail');
    const pageDock = screen.getByTestId('navigation-page-action-surface');
    const [navigationTop, navigationBottom] = (
      screen.getByTestId('navigation-right-rail-vertical-insets').props
        .children as string
    )
      .split(',')
      .map(Number);
    const [pageTop, pageBottom] = (
      screen.getByTestId('navigation-page-action-surface-vertical-insets').props
        .children as string
    )
      .split(',')
      .map(Number);

    expect(navigation.props.accessibilityHint).toBe(side);
    expect(pageDock.props.accessibilityHint).toBe(side);
    expect(
      screen.getByTestId('navigation-right-rail-actions').props.children,
    ).toBe('back:false,home:false');
    expect(pageTop).toBeGreaterThan(navigationTop);
    expect(pageBottom).toBeGreaterThan(navigationBottom);
    expect(
      screen.getByTestId('navigation-page-action-surface-actions').props
        .children,
    ).toBe(pageIDs.map(id => `page:${id}:false`).join(','));
    expect(
      within(pageDock)
        .getAllByRole('button')
        .map(button => button.props.testID),
    ).toEqual(pageIDs);
  };

  assertBackFirst('right', initialIDs);
  await rerender(
    <Fixture
      geometry={leftSplitGeometry}
      pageActions={updatedIDs.map(action)}
    />,
  );
  assertBackFirst('left', updatedIDs);
});
