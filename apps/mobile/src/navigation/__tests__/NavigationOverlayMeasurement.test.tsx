import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { NavigationActionBarPresentation } from '../NavigationActionBarPresentation';
import { NavigationGeometryProvider } from '../NavigationGeometryProvider';
import { NavigationViewport } from '../NavigationViewport';
import { NavigationGlassSurface } from '../NavigationGlassSurface';
import { useNavigationContentFrame } from '../navigationContentFrame';

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
