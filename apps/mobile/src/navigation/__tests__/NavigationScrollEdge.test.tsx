import { fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable, StyleSheet } from 'react-native';
import { NavigationEdgeMenuScrollView } from '../NavigationEdgeMenuScrollView';
import {
  NavigationContentFrameContext,
  type NavigationContentFrame,
} from '../navigationContentFrame';
import { NavigationRouteScrollView } from '../NavigationRouteScrollView';
import { resolveNavigationRightScrollEdge } from '../navigationScrollEdge';

const windowFrame = { x: 0, y: 0, width: 466, height: 678 };
const rightRail: NavigationContentFrame = {
  side: 'right',
  windowFrame,
  viewportFrame: windowFrame,
  availableContentFrame: { ...windowFrame, width: 382 },
  reservedRegions: [
    {
      kind: 'occlusion',
      id: 'system-edge',
      frame: { ...windowFrame, x: 382, width: 84, height: 174 },
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      isActive: true,
    },
  ],
  navigationFrame: { x: 406, y: 174, width: 48, height: 270 },
};

test('only claims a measured device right edge, never a clipped split viewport or active seam', () => {
  expect(resolveNavigationRightScrollEdge(rightRail)).toBe(84);
  expect(resolveNavigationRightScrollEdge({ ...rightRail, side: 'left' })).toBe(
    0,
  );
  expect(
    resolveNavigationRightScrollEdge({ ...rightRail, side: 'bottom' }),
  ).toBe(0);
  expect(resolveNavigationRightScrollEdge(null)).toBe(0);
  expect(
    resolveNavigationRightScrollEdge({
      ...rightRail,
      viewportFrame: { ...windowFrame, width: 430 },
    }),
  ).toBe(0);
  expect(
    resolveNavigationRightScrollEdge({
      ...rightRail,
      reservedRegions: [{ ...rightRail.reservedRegions[0]!, kind: 'division' }],
    }),
  ).toBe(0);
});

test('moves the native route indicator to the outer edge without widening content or disabling keyboard clearance', async () => {
  await render(
    <NavigationContentFrameContext.Provider value={rightRail}>
      <NavigationRouteScrollView>
        <Pressable testID="ordinary-control" />
      </NavigationRouteScrollView>
    </NavigationContentFrameContext.Provider>,
  );
  const scroll = screen.getByTestId('navigation-route-scroll');
  expect(StyleSheet.flatten(scroll.props.style)).toMatchObject({
    marginRight: -84,
  });
  expect(StyleSheet.flatten(scroll.props.contentContainerStyle)).toMatchObject({
    paddingRight: 84,
  });
  expect(scroll.props.automaticallyAdjustKeyboardInsets).toBe(true);
  expect(scroll.props.automaticallyAdjustsScrollIndicatorInsets).toBe(false);
  expect(scroll.props.scrollIndicatorInsets).toMatchObject({
    top: 174,
    right: 0,
  });
});

test('keeps menu actions out of the rail and puts terminal padding on the right', async () => {
  const selected = jest.fn();
  await render(
    <NavigationEdgeMenuScrollView
      rightBleed={104}
      touchClearance={84}
      testID="menu"
    >
      <Pressable testID="action" onPress={selected} />
    </NavigationEdgeMenuScrollView>,
  );
  const menu = screen.getByTestId('menu');
  const shield = screen.getByTestId('navigation-edge-menu-touch-clearance', {
    includeHiddenElements: true,
  });
  expect(menu.props.horizontal).toBe(true);
  expect(StyleSheet.flatten(menu.parent?.props.style)).toMatchObject({
    marginRight: -104,
  });
  expect(StyleSheet.flatten(menu.props.contentContainerStyle)).toMatchObject({
    paddingRight: 104,
  });
  expect(StyleSheet.flatten(shield.props.style)).toMatchObject({
    right: 0,
    width: 84,
  });
  expect(shield.props.accessibilityElementsHidden).toBe(true);
  await fireEvent.press(screen.getByTestId('action'));
  expect(selected).toHaveBeenCalledTimes(1);
});
