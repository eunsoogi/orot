import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { NavigationSurfaceProps } from '../NavigationActionBar';
import { NavigationActionBarPresentation } from '../NavigationActionBarPresentation';
import { createNavigationGeometrySnapshot } from '../navigationGeometry';
import type { NavigationGeometryPayload } from '../navigationGeometry';
import {
  NavigationRootLayoutContext,
  resolveNavigationRootLayout,
} from '../navigationRootLayout';
import {
  openGeometry,
  rotatedGeometry,
} from './navigationOpenGeometry.fixture';

/** Exposes only the native presentation contract; this is not native UI proof. */
function Surface({
  actions = [],
  children,
  layoutMode,
  testID,
}: NavigationSurfaceProps) {
  return (
    <View accessibilityHint={layoutMode} testID={testID}>
      <Text testID={`${testID}-actions`}>
        {actions
          .map(action => `${action.id}:${action.disabled === true}`)
          .join(',')}
      </Text>
      {children}
    </View>
  );
}

function Fixture({
  geometry,
  keyboardHeight = 0,
}: {
  readonly geometry: NavigationGeometryPayload;
  readonly keyboardHeight?: number;
}) {
  const [draft, setDraft] = useState('original');
  const layout = resolveNavigationRootLayout(
    createNavigationGeometrySnapshot(geometry),
  );
  return (
    <NavigationRootLayoutContext.Provider value={layout}>
      <Pressable onPress={() => setDraft('edited')} testID="edit-draft">
        <Text testID="draft">{draft}</Text>
      </Pressable>
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
          {
            id: 'primary',
            label: 'Save',
            accessibilityLabel: 'Save',
            testID: 'save',
            disabled: true,
          },
        ]}
        bottomActions={<Text>Bottom actions</Text>}
        isDarkAppearance={false}
        keyboardHeight={keyboardHeight}
        keyboardVisible={keyboardHeight > 0}
        onAction={jest.fn()}
        primaryAction={{
          label: 'Save',
          accessibilityLabel: 'Save',
          testID: 'save',
          onPress: () => undefined,
        }}
        reclaimRootTabInset={false}
        safeAreaHandledByParent
        surface={Surface}
      />
    </NavigationRootLayoutContext.Provider>
  );
}

test('retains draft and disabled primary action across continuous Open geometry and keyboard fallback', async () => {
  const { rerender } = await render(<Fixture geometry={openGeometry} />);
  await fireEvent.press(screen.getByTestId('edit-draft'));
  expect(
    screen.getByTestId('navigation-right-rail-actions').props.children,
  ).toBe('back:false,home:false');
  expect(
    screen.getByTestId('navigation-primary-action-surface-actions').props
      .children,
  ).toBe('primary:true');

  await rerender(<Fixture geometry={rotatedGeometry} />);
  expect(screen.getByTestId('draft').props.children).toBe('edited');
  expect(
    screen.getByTestId('navigation-right-rail').props.accessibilityHint,
  ).toBe('right');

  // Fit remains a presentation decision even after the continuous geometry admits a rail.
  await rerender(<Fixture geometry={rotatedGeometry} keyboardHeight={850} />);
  expect(screen.queryByTestId('navigation-right-rail')).toBeNull();
  expect(
    screen.getByTestId('navigation-bar-fallback-actions').props.children,
  ).toBe('back:false,home:false,primary:true');
  expect(screen.getByTestId('draft').props.children).toBe('edited');

  await rerender(<Fixture geometry={rotatedGeometry} />);
  expect(
    screen.getByTestId('navigation-right-rail').props.accessibilityHint,
  ).toBe('right');
  expect(screen.getByTestId('draft').props.children).toBe('edited');
  expect(
    screen.getByTestId('navigation-primary-action-surface-actions').props
      .children,
  ).toBe('primary:true');
});
