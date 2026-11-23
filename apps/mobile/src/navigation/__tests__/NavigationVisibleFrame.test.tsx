import { fireEvent, render, screen } from '@testing-library/react-native';
import { useContext, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { NavigationGeometryProvider } from '../NavigationGeometryProvider';
import { NavigationViewport } from '../NavigationViewport';
import { useNavigationContentFrame } from '../navigationContentFrame';
import { NavigationRootLayoutContext } from '../navigationRootLayout';
import { useNavigationContentInset } from '../useNavigationContentInset';
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
    height: 669,
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
    availableContentFrame: { width: 867, height: 669 },
  });
  expect(screen.getByText('edited')).toBeTruthy();
});

function EndClearance() {
  const inset = useNavigationContentInset();
  return <Text testID="end-clearance">{inset.paddingBottom}</Text>;
}

test('all scenes draw through the home area with safe end padding, then release it for the keyboard', async () => {
  await render(
    <NavigationGeometryProvider>
      <NavigationViewport childHandlesSafeArea actionBar={<View />}>
        <EndClearance />
      </NavigationViewport>
    </NavigationGeometryProvider>,
  );
  await fireEvent(
    screen.getByTestId('navigation-window-geometry-sensor'),
    'geometryChange',
    {
      nativeEvent: { ...openGeometry, hasHinge: true, navigationSide: 'right' },
    },
  );
  const viewport = screen.getByTestId('navigation-visible-viewport');
  await fireEvent(viewport, 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 951, height: 669 } },
  });
  expect(
    StyleSheet.flatten(
      screen.getByTestId('navigation-content-region').props.style,
    ).bottom,
  ).toBe(0);
  expect(screen.getByTestId('end-clearance').props.children).toBe(50);
  await fireEvent(viewport, 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 951, height: 420 } },
  });
  expect(screen.getByTestId('end-clearance').props.children).toBe(16);
});

test('never publishes an empty measured viewport over a still-valid native window', async () => {
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
  const layout = (height: number) =>
    fireEvent(viewport, 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 951, height } },
    });
  const frame = () =>
    JSON.parse(screen.getByTestId('shared-frame').props.children)
      .availableContentFrame;
  await fireEvent(sensor, 'geometryChange', { nativeEvent: payload });
  await layout(669);
  await fireEvent.press(screen.getByTestId('edit-draft'));
  const draft = screen.getByText('edited');
  expect(frame()).toEqual({ x: 0, y: 0, width: 867, height: 669 });

  // Isolate the React receiving contract; this input is synthetic, not an
  // observation that iOS emits it when leaving the real app switcher.
  await layout(0);
  await layout(Number.NaN);
  expect(frame()).toEqual({ x: 0, y: 0, width: 867, height: 669 });
  expect(screen.getByText('edited')).toBe(draft);

  // The next real positive layout is still decisive (e.g. keyboard or a resize).
  await layout(420);
  expect(frame()).toEqual({ x: 0, y: 0, width: 867, height: 420 });
});

test('a replacement route and native resize do not inherit the prior constrained measurement', async () => {
  function tree(route: string) {
    return (
      <NavigationGeometryProvider>
        <NavigationViewport
          key={route}
          childHandlesSafeArea
          actionBar={<View />}
        >
          <Probe />
        </NavigationViewport>
      </NavigationGeometryProvider>
    );
  }
  const rendered = await render(tree('first'));
  const sensor = screen.getByTestId('navigation-window-geometry-sensor');
  const layout = (height: number) =>
    fireEvent(screen.getByTestId('navigation-visible-viewport'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 951, height } },
    });
  const frameHeight = () =>
    JSON.parse(screen.getByTestId('shared-frame').props.children)
      .availableContentFrame.height;
  await fireEvent(sensor, 'geometryChange', { nativeEvent: openGeometry });
  await layout(420);
  expect(frameHeight()).toBe(420);

  await rendered.rerender(tree('second'));
  await layout(0);
  expect(frameHeight()).toBe(669);
  await layout(400);
  expect(frameHeight()).toBe(400);

  await fireEvent(sensor, 'geometryChange', {
    nativeEvent: {
      ...openGeometry,
      windowBounds: { ...openGeometry.windowBounds, height: 700 },
    },
  });
  expect(frameHeight()).toBe(700);
  await layout(0);
  expect(frameHeight()).toBe(700);
  // Returning to the old size does not resurrect the old cached measurement.
  await fireEvent(sensor, 'geometryChange', { nativeEvent: openGeometry });
  expect(frameHeight()).toBe(669);
});
