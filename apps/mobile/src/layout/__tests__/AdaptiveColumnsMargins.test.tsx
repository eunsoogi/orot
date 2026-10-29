import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text, View } from 'react-native';
import { NavigationGeometryProvider } from '../../navigation/NavigationGeometryProvider';
import { openGeometry } from '../../navigation/__fixtures__/navigationOpenGeometry';
import { AdaptiveColumns } from '../AdaptiveColumns';

const measurable = View as unknown as {
  prototype: {
    measureInWindow: (
      callback: (x: number, y: number, width: number, height: number) => void,
    ) => void;
  };
};

test('consumes the native margin-inclusive reserved frame once at the content boundary', async () => {
  const dimensions = jest
    .spyOn(require('react-native'), 'useWindowDimensions')
    .mockReturnValue({ width: 951, height: 669, scale: 3, fontScale: 1 });
  const measurement = jest
    .spyOn(measurable.prototype, 'measureInWindow')
    .mockImplementation(callback => callback(0, 0, 867, 635));
  try {
    await render(
      <NavigationGeometryProvider>
        <AdaptiveColumns
          primary={<Text>Primary</Text>}
          secondary={<Text>Secondary</Text>}
        />
      </NavigationGeometryProvider>,
    );
    const sensor = screen.getByTestId('navigation-window-geometry-sensor');
    const boundary = {
      ...openGeometry,
      reservedRegions: openGeometry.reservedRegions.map(region => ({
        ...region,
        // UIKit already includes this 20pt margin in frame.x=867; do not invent overlap at x=847.
        margins: region.isActive
          ? { ...region.margins, left: 20 }
          : region.margins,
      })),
    };
    const axis = () =>
      StyleSheet.flatten(screen.getByTestId('adaptive-columns').props.style)
        ?.flexDirection;
    await fireEvent(sensor, 'geometryChange', { nativeEvent: boundary });
    expect(axis()).toBe('row');
    await fireEvent(sensor, 'geometryChange', {
      nativeEvent: {
        ...boundary,
        reservedRegions: boundary.reservedRegions.map(region =>
          region.isActive
            ? { ...region, frame: { ...region.frame, x: 840 } }
            : region,
        ),
      },
    });
    expect(axis()).toBe('column');
  } finally {
    measurement.mockRestore();
    dimensions.mockRestore();
  }
});
