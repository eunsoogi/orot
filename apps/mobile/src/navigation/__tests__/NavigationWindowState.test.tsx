import { fireEvent, render, screen } from '@testing-library/react-native';
import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { NavigationGeometryProvider } from '../NavigationGeometryProvider';
import { NavigationViewport } from '../NavigationViewport';
import { useNavigationContentFrame } from '../navigationContentFrame';
import type { NavigationGeometryPayload } from '../navigationGeometry';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

const mounted = jest.fn();
const unmounted = jest.fn();

function RetainedRoute() {
  const [draft, setDraft] = useState('');
  const [selected, setSelected] = useState('first');
  const frame = useNavigationContentFrame();
  useEffect(() => {
    mounted();
    return unmounted;
  }, []);
  return (
    <View>
      <TextInput testID="draft" value={draft} onChangeText={setDraft} />
      <Pressable testID="select" onPress={() => setSelected('second')}>
        <Text>{selected}</Text>
      </Pressable>
      <Text testID="frame">{JSON.stringify(frame)}</Text>
    </View>
  );
}

// This tests React state retention using synthetic native events. Actual window
// placement, keyboard, scroll offsets and running native work need Simulator proof.
test('retains the same route, edited input and selection across side and viewport changes', async () => {
  mounted.mockClear();
  unmounted.mockClear();
  await render(
    <NavigationGeometryProvider>
      <NavigationViewport childHandlesSafeArea actionBar={<View />}>
        <RetainedRoute />
      </NavigationViewport>
    </NavigationGeometryProvider>,
  );
  await fireEvent.changeText(screen.getByTestId('draft'), '합성 입력 유지');
  await fireEvent.press(screen.getByTestId('select'));
  const originalInput = screen.getByTestId('draft');
  const sensor = screen.getByTestId('navigation-window-geometry-sensor');
  const viewport = screen.getByTestId('navigation-visible-viewport');
  const full: NavigationGeometryPayload = {
    windowBounds: { x: 0, y: 0, width: 1000, height: 800 },
    safeAreaInsets: { top: 0, left: 0, right: 84, bottom: 34 },
    reservedRegionsSupported: true,
    reservedRegions: [],
    hasHinge: true,
    navigationSide: 'right',
  };
  const left: NavigationGeometryPayload = {
    ...full,
    windowBounds: { ...full.windowBounds, width: 500 },
    safeAreaInsets: { ...full.safeAreaInsets, left: 84, right: 0 },
    navigationSide: 'left',
  };
  const right: NavigationGeometryPayload = {
    ...left,
    safeAreaInsets: full.safeAreaInsets,
    navigationSide: 'right',
  };
  for (const payload of [full, left, right, full]) {
    await fireEvent(sensor, 'geometryChange', { nativeEvent: payload });
    await fireEvent(viewport, 'layout', {
      nativeEvent: { layout: payload.windowBounds },
    });
    const frame = JSON.parse(screen.getByTestId('frame').props.children);
    expect(frame.side).toBe(payload.navigationSide);
    expect(frame.availableContentFrame).toEqual({
      x: payload.safeAreaInsets.left,
      y: 0,
      width: payload.windowBounds.width - 84,
      height: 766,
    });
    expect(screen.getByTestId('draft')).toBe(originalInput);
    expect(originalInput.props.value).toBe('합성 입력 유지');
    expect(screen.getByText('second')).toBeTruthy();
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
  }
});
