import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  NavigationGeometryProvider,
  useNavigationGeometry,
} from '../NavigationGeometryProvider';
import type { NavigationGeometryPayload } from '../navigationGeometry';

function GeometryReadout() {
  const geometry = useNavigationGeometry();
  const [draft, setDraft] = useState('untouched');
  const usableRegionCount = geometry?.usableRegions.length ?? 0;
  return (
    <View>
      <Text testID="geometry-readout">
        {geometry
          ? `${geometry.windowBounds.width}x${geometry.windowBounds.height}; regions=${usableRegionCount}`
          : 'geometry-pending'}
      </Text>
      <Text testID="draft-readout">{draft}</Text>
      <Pressable onPress={() => setDraft('edited')} testID="edit-draft">
        <Text>Edit draft</Text>
      </Pressable>
    </View>
  );
}

const basePayload: NavigationGeometryPayload = {
  windowBounds: { x: 0, y: 0, width: 400, height: 800 },
  safeAreaInsets: { top: 24, right: 12, bottom: 30, left: 12 },
  reservedRegionsSupported: false,
  reservedRegions: [],
};

test('publishes native geometry updates without resetting route-local state', async () => {
  await render(
    <NavigationGeometryProvider>
      <GeometryReadout />
    </NavigationGeometryProvider>,
  );

  expect(screen.getByText('geometry-pending')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('edit-draft'));

  const sensor = screen.getByTestId('navigation-window-geometry-sensor');
  await fireEvent(sensor, 'geometryChange', { nativeEvent: basePayload });
  expect(screen.getByText('400x800; regions=1')).toBeTruthy();
  expect(screen.getByText('edited')).toBeTruthy();

  const expandedPayload: NavigationGeometryPayload = {
    ...basePayload,
    reservedRegionsSupported: true,
    reservedRegions: [
      {
        id: 'fold',
        kind: 'division',
        frame: { x: 195, y: 0, width: 10, height: 800 },
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
        isActive: true,
      },
    ],
  };
  await fireEvent(sensor, 'geometryChange', { nativeEvent: expandedPayload });

  expect(screen.getByText('400x800; regions=2')).toBeTruthy();
  expect(screen.getByText('edited')).toBeTruthy();
});
