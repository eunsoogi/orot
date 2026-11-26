import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { NavigationActionBarPresentation } from '../NavigationActionBarPresentation';
import { NavigationGeometryProvider } from '../NavigationGeometryProvider';
import { NavigationViewport } from '../NavigationViewport';
import { NavigationGlassSurface } from '../NavigationGlassSurface';
import { useNavigationContentFrame } from '../navigationContentFrame';
import { openGeometry } from '../__fixtures__/navigationOpenGeometry';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

const actions = [
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
];
const onAction = jest.fn();
function Probe() {
  return (
    <Text testID="diagnostic-shared">
      {JSON.stringify(useNavigationContentFrame())}
    </Text>
  );
}
function Fixture({ keyboardVisible = false }: { keyboardVisible?: boolean }) {
  return (
    <NavigationGeometryProvider>
      <NavigationViewport
        childHandlesSafeArea
        actionBar={
          <NavigationActionBarPresentation
            actions={actions}
            bottomActions={<Text>Controls</Text>}
            isDarkAppearance={false}
            keyboardHeight={keyboardVisible ? 328 : 0}
            keyboardVisible={keyboardVisible}
            onAction={onAction}
            reclaimRootTabInset={false}
            safeAreaHandledByParent
            surface={NavigationGlassSurface}
          />
        }
      >
        <Probe />
      </NavigationViewport>
    </NavigationGeometryProvider>
  );
}
test('invalidates native measurement only after overlay layout and preserves the mounted surface', async () => {
  const { rerender } = await render(<Fixture />);
  const sensor = screen.getByTestId('navigation-window-geometry-sensor');
  const viewport = screen.getByTestId('navigation-visible-viewport');
  const overlay = screen.getByTestId('navigation-action-bar-overlay');
  const geometry = {
    windowBounds: { x: 0, y: 0, width: 402, height: 874 },
    viewportBounds: { x: 0, y: 0, width: 402, height: 874 },
    safeAreaInsets: { top: 62, right: 0, bottom: 34, left: 0 },
    reservedRegionsSupported: false,
    reservedRegions: [],
    hasHinge: false,
    navigationSide: 'bottom',
    navigationFrame: { x: 24, y: 792, width: 354, height: 48 },
  };
  await fireEvent(sensor, 'geometryChange', { nativeEvent: geometry });
  await fireEvent(viewport, 'layout', {
    nativeEvent: { layout: geometry.viewportBounds },
  });
  // Overlay frames here are deterministic inputs, not independent native measurements.
  await fireEvent(overlay, 'layout', {
    nativeEvent: { layout: { x: 0, y: 792, width: 402, height: 82 } },
  });
  const read = () =>
    JSON.parse(screen.getByTestId('diagnostic-shared').props.children);
  const host = () => screen.getByTestId('navigation-bar-native-surface');
  const originalHost = host(),
    originalActions = host().props.actions;
  expect(host().props.geometryLayoutRevision).toBe('[0,792,402,82]');
  await fireEvent(viewport, 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 402, height: 546 } },
  });
  // A viewport event alone precedes the overlay's committed position; it must not request early measurement.
  expect(host().props.geometryLayoutRevision).toBe('[0,792,402,82]');
  await fireEvent(overlay, 'layout', {
    nativeEvent: { layout: { x: 0, y: 464, width: 402, height: 82 } },
  });
  await rerender(<Fixture keyboardVisible />);
  const after = { shared: read() };
  expect(host().props.geometryLayoutRevision).toBe('[0,464,402,82]');
  expect(after.shared.availableContentFrame).toEqual({
    x: 0,
    y: 62,
    width: 402,
    height: 484,
  });
  expect(host()).toBe(originalHost);
  expect(host().props.actions).toBe(originalActions);
  // A synthetic native event verifies only that consumers accept a fresh measurement.
  const next = {
    ...geometry,
    navigationFrame: { ...geometry.navigationFrame, y: 498 },
  };
  await fireEvent(sensor, 'geometryChange', { nativeEvent: next });
  expect(read().navigationFrame).toEqual(next.navigationFrame);
  // The invalidation coordinates are not a replacement for UIKit's differently positioned controls.
  expect(read().navigationFrame.y).not.toBe(464);
  await fireEvent(viewport, 'layout', {
    nativeEvent: { layout: geometry.viewportBounds },
  });
  await fireEvent(overlay, 'layout', {
    nativeEvent: { layout: { x: 0, y: 792, width: 402, height: 82 } },
  });
  await rerender(<Fixture />);
  expect(host().props.geometryLayoutRevision).toBe('[0,792,402,82]');
  expect(host()).toBe(originalHost);
});

test('a late native viewport recovery wakes the same admitted right rail without moving the local overlay', async () => {
  const view = await render(<Fixture />);
  try {
    const sensor = screen.getByTestId('navigation-window-geometry-sensor');
    const overlay = screen.getByTestId('navigation-action-bar-overlay');
    const contracted = {
      ...openGeometry,
      safeAreaInsets: { ...openGeometry.safeAreaInsets, right: 86 },
      viewportBounds: { ...openGeometry.windowBounds, width: 920 },
    };
    await fireEvent(sensor, 'geometryChange', { nativeEvent: contracted });
    await fireEvent(overlay, 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 920, height: 669 } },
    });
    const rail = screen.getByTestId('navigation-right-rail');
    const previous = rail.props.geometryLayoutRevision;
    const top = rail.props.railBackTopInset;
    const right = rail.props.railRightInset;
    const height = rail.props.railAvailableHeight;
    expect(top).toBeGreaterThan(0);
    // UIKit recovers full-root containment; the action overlay has not resized
    // yet. Only this native sensor update reaches the presentation.
    const expanded = {
      ...contracted,
      viewportBounds: openGeometry.windowBounds,
    };
    await fireEvent(sensor, 'geometryChange', { nativeEvent: expanded });
    expect(screen.getByTestId('navigation-right-rail')).toBe(rail);
    expect(rail.props.railBackTopInset).toBe(top);
    expect(rail.props.railRightInset).toBe(right);
    expect(rail.props.railAvailableHeight).toBe(height);
    expect(rail.props.geometryLayoutRevision).not.toBe(previous);
    const recovered = rail.props.geometryLayoutRevision;
    await fireEvent(sensor, 'geometryChange', {
      nativeEvent: {
        ...expanded,
        navigationSide: 'right',
        navigationFrame: { x: 894, y: 192, width: 48, height: 48 },
      },
    });
    // Publishing the native Back frame must not re-wake its own geometry.
    expect(rail.props.geometryLayoutRevision).toBe(recovered);
  } finally {
    await view.unmount();
  }
});
