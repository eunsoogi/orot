import { fireEvent, render, screen } from '@testing-library/react-native';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { NavigationGeometryProvider } from '../../navigation/NavigationGeometryProvider';
import type { NavigationGeometryPayload } from '../../navigation/navigationGeometry';
import { AdaptiveColumns } from '../AdaptiveColumns';
import { openGeometry } from '../../navigation/__fixtures__/navigationOpenGeometry';

function StatefulPanel({
  name,
  onStartRequest,
}: {
  readonly name: string;
  readonly onStartRequest: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [selected, setSelected] = useState(false);
  useEffect(() => {
    onStartRequest();
  }, [onStartRequest]);

  return (
    <View>
      <TextInput
        onChangeText={setDraft}
        testID={`${name}-draft`}
        value={draft}
      />
      <Pressable
        onPress={() => setSelected(value => !value)}
        testID={`${name}-selection`}
      >
        <Text testID={`${name}-selection-label`}>
          {selected ? 'selected' : 'unselected'}
        </Text>
      </Pressable>
    </View>
  );
}

function TestPanels({
  startPrimary,
  startSecondary,
}: {
  readonly startPrimary: () => void;
  readonly startSecondary: () => void;
}) {
  return (
    <AdaptiveColumns
      primary={<StatefulPanel name="primary" onStartRequest={startPrimary} />}
      secondary={
        <StatefulPanel name="secondary" onStartRequest={startSecondary} />
      }
    />
  );
}

function axis(testID: string): string | undefined {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style)
    ?.flexDirection;
}

const measurableView = View as unknown as {
  prototype: {
    measureInWindow: (
      callback: (x: number, y: number, width: number, height: number) => void,
    ) => void;
  };
};
const noInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const windowBounds = new Map<
  string,
  { readonly x: number; readonly width: number }
>();

beforeEach(() => windowBounds.clear());

jest
  .spyOn(measurableView.prototype, 'measureInWindow')
  .mockImplementation(function (
    this: { readonly props: { readonly testID?: string } },
    callback,
  ) {
    const bounds = windowBounds.get(this.props.testID ?? '');
    if (bounds) callback(bounds.x, 0, bounds.width, 600);
  });

function setWindowBounds(testID: string, x: number, width: number) {
  windowBounds.set(testID, { x, width });
}

test('reflows mounted panels while retaining drafts, selection, and request owners', async () => {
  const startPrimary = jest.fn();
  const startSecondary = jest.fn();
  await render(
    <TestPanels startPrimary={startPrimary} startSecondary={startSecondary} />,
  );

  expect(axis('adaptive-columns')).toBe('column');
  await fireEvent.changeText(
    screen.getByTestId('primary-draft'),
    'question draft',
  );
  await fireEvent.press(screen.getByTestId('secondary-selection'));
  setWindowBounds('adaptive-columns-host', 0, 1400);
  await fireEvent(screen.getByTestId('adaptive-columns-host'), 'layout', {
    nativeEvent: { layout: { width: 1400, height: 600, x: 0, y: 0 } },
  });

  expect(axis('adaptive-columns')).toBe('row');
  expect(screen.getByTestId('primary-draft').props.value).toBe(
    'question draft',
  );
  expect(screen.getByTestId('secondary-selection-label').props.children).toBe(
    'selected',
  );
  expect(startPrimary).toHaveBeenCalledTimes(1);
  expect(startSecondary).toHaveBeenCalledTimes(1);

  setWindowBounds('adaptive-columns-host', 0, 1200);
  await fireEvent(screen.getByTestId('adaptive-columns-host'), 'layout', {
    nativeEvent: { layout: { width: 1200, height: 600, x: 0, y: 0 } },
  });

  expect(axis('adaptive-columns')).toBe('column');
  expect(screen.getByTestId('primary-draft').props.value).toBe(
    'question draft',
  );
  expect(startPrimary).toHaveBeenCalledTimes(1);
  expect(startSecondary).toHaveBeenCalledTimes(1);
});

test('remeasures a padded host when native window regions change', async () => {
  await render(
    <NavigationGeometryProvider>
      <TestPanels startPrimary={jest.fn()} startSecondary={jest.fn()} />
    </NavigationGeometryProvider>,
  );

  setWindowBounds('adaptive-columns-host', 24, 1400);
  const geometry: NavigationGeometryPayload = {
    windowBounds: { x: 0, y: 0, width: 1700, height: 800 },
    safeAreaInsets: noInsets,
    reservedRegionsSupported: true,
    reservedRegions: [
      {
        id: 'division',
        kind: 'division',
        frame: { x: 700, y: 0, width: 20, height: 800 },
        margins: noInsets,
        isActive: true,
      },
      {
        id: 'right-rail',
        kind: 'occlusion',
        frame: { x: 1640, y: 0, width: 60, height: 800 },
        margins: noInsets,
        isActive: true,
      },
    ],
  };
  await fireEvent(
    screen.getByTestId('navigation-window-geometry-sensor'),
    'geometryChange',
    { nativeEvent: geometry },
  );

  expect(axis('adaptive-columns')).toBe('row');
  expect(
    StyleSheet.flatten(
      screen.getByTestId('adaptive-columns-primary').props.style,
    )?.width,
  ).toBe(674);
  expect(
    StyleSheet.flatten(
      screen.getByTestId('adaptive-columns-secondary').props.style,
    )?.width,
  ).toBe(702);

  setWindowBounds('adaptive-columns-host', 40, 1400);
  const shiftedGeometry: NavigationGeometryPayload = {
    ...geometry,
    windowBounds: { ...geometry.windowBounds, x: 16 },
    reservedRegions: geometry.reservedRegions.map(region => ({
      ...region,
      frame: { ...region.frame, x: region.frame.x + 16 },
    })),
  };
  await fireEvent(
    screen.getByTestId('navigation-window-geometry-sensor'),
    'geometryChange',
    { nativeEvent: shiftedGeometry },
  );

  expect(
    StyleSheet.flatten(
      screen.getByTestId('adaptive-columns-primary').props.style,
    )?.width,
  ).toBe(674);
  expect(
    StyleSheet.flatten(
      screen.getByTestId('adaptive-columns-secondary').props.style,
    )?.width,
  ).toBe(702);
});

test('uses readable content width without treating the reserved system lane as an internal obstacle', async () => {
  const dimensions = jest
    .spyOn(require('react-native'), 'useWindowDimensions')
    .mockReturnValue({ width: 951, height: 669, scale: 3, fontScale: 1 });
  try {
    setWindowBounds('adaptive-columns-host', 0, 867);
    await render(
      <NavigationGeometryProvider>
        <TestPanels startPrimary={jest.fn()} startSecondary={jest.fn()} />
      </NavigationGeometryProvider>,
    );
    const sensor = screen.getByTestId('navigation-window-geometry-sensor');
    await fireEvent(sensor, 'geometryChange', { nativeEvent: openGeometry });
    expect(axis('adaptive-columns')).toBe('row');

    // The same obstruction inside the actual content must retain its avoidance policy.
    await fireEvent(sensor, 'geometryChange', {
      nativeEvent: {
        ...openGeometry,
        reservedRegions: openGeometry.reservedRegions.map(region =>
          region.isActive
            ? { ...region, frame: { ...region.frame, x: 400 } }
            : region,
        ),
      },
    });
    expect(axis('adaptive-columns')).toBe('column');

    setWindowBounds('adaptive-columns-host', 0, 663);
    await fireEvent(sensor, 'geometryChange', { nativeEvent: openGeometry });
    expect(axis('adaptive-columns')).toBe('column');
    dimensions.mockReturnValue({
      width: 951,
      height: 669,
      scale: 3,
      fontScale: 2,
    });
    setWindowBounds('adaptive-columns-host', 0, 867);
    await fireEvent(screen.getByTestId('adaptive-columns-host'), 'layout');
    expect(axis('adaptive-columns')).toBe('column');
  } finally {
    dimensions.mockRestore();
  }
});
