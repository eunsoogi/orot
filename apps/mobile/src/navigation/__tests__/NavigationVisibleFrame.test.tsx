import { fireEvent, render, screen } from '@testing-library/react-native';
import { useContext, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { NavigationGeometryProvider } from '../NavigationGeometryProvider';
import { NavigationViewport } from '../NavigationViewport';
import { useNavigationContentFrame } from '../navigationContentFrame';
import { NavigationRootLayoutContext } from '../navigationRootLayout';
import { openGeometry } from '../__fixtures__/navigationOpenGeometry';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

function Probe() {
  const frame = useNavigationContentFrame();
  const candidate = useContext(NavigationRootLayoutContext);
  const [draft, setDraft] = useState('original');
  return (
    <>
      <Text testID="shared-frame">{JSON.stringify(frame)}</Text>
      <Text testID="candidate">{candidate.placement}</Text>
      <Pressable onPress={() => setDraft('edited')} testID="edit-draft">
        <Text>{draft}</Text>
      </Pressable>
    </>
  );
}

/** Models native host layouts; actual keyboard and UIKit interaction remain a separate XCTest boundary. */
test('shares the visible keyboard frame and observed fallback without latching candidate admission or losing a draft', async () => {
  await render(
    <NavigationGeometryProvider>
      <NavigationViewport childHandlesSafeArea actionBar={<View />}>
        <Probe />
      </NavigationViewport>
    </NavigationGeometryProvider>,
  );
  const sensor = screen.getByTestId('navigation-window-geometry-sensor');
  const viewport = screen.getByTestId('navigation-visible-viewport');
  const payload = {
    ...openGeometry,
    hasHinge: true,
    navigationSide: 'right' as const,
  };
  await fireEvent(sensor, 'geometryChange', { nativeEvent: payload });
  await fireEvent(viewport, 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 951, height: 669 } },
  });
  await fireEvent.press(screen.getByTestId('edit-draft'));
  const read = () =>
    JSON.parse(screen.getByTestId('shared-frame').props.children);
  expect(read().availableContentFrame).toEqual({
    x: 0,
    y: 0,
    width: 867,
    height: 635,
  });

  await fireEvent(viewport, 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 951, height: 420 } },
  });
  await fireEvent(sensor, 'geometryChange', {
    nativeEvent: { ...payload, navigationSide: 'bottom' },
  });
  expect(read()).toMatchObject({
    side: 'bottom',
    availableContentFrame: { x: 0, y: 0, width: 867, height: 420 },
  });
  // The keyboard-contracted parent already ends above the original home area.
  expect(
    StyleSheet.flatten(
      screen.getByTestId('navigation-content-region').props.style,
    ),
  ).toMatchObject({ bottom: 0, right: 84 });
  expect(screen.getByTestId('candidate').props.children).toBe('right');

  await fireEvent(viewport, 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 951, height: 669 } },
  });
  await fireEvent(sensor, 'geometryChange', { nativeEvent: payload });
  expect(read()).toMatchObject({
    side: 'right',
    availableContentFrame: { width: 867, height: 635 },
  });
  expect(screen.getByText('edited')).toBeTruthy();
});
