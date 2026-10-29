import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';
import { HealthRecordsLibraryScreen } from '../HealthRecordsLibraryScreen';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';

const measurableView = View as unknown as {
  prototype: {
    measureInWindow: (
      callback: (x: number, y: number, width: number, height: number) => void,
    ) => void;
  };
};

test('keeps the selected type and loaded series when the library panels reflow', async () => {
  const bounds = new Map<
    string,
    { readonly x: number; readonly width: number }
  >();
  const measure = jest
    .spyOn(measurableView.prototype, 'measureInWindow')
    .mockImplementation(function (
      this: { readonly props: { readonly testID?: string } },
      callback,
    ) {
      const measured = bounds.get(this.props.testID ?? '');
      if (measured) callback(measured.x, 0, measured.width, 700);
    });
  const loadObservations = jest.fn(async () => ({
    records: [
      healthObservation(
        'reflow-heart-rate',
        'heart_rate',
        '2026-10-05T10:00:00.000Z',
      ),
    ],
    nextCursor: null,
  }));

  try {
    await render(
      <HealthRecordsLibraryScreen
        loadObservations={loadObservations}
        onBack={jest.fn()}
        onOpenHealthImport={jest.fn()}
        onOpenDetail={jest.fn()}
      />,
    );
    await fireEvent.press(
      screen.getByTestId('health-record-filter-heart_rate'),
    );
    const heartRateFilterSelected = () =>
      screen.getByTestId('health-record-filter-heart_rate').props
        .accessibilityState?.selected;
    expect(heartRateFilterSelected()).toBe(true);

    const host = screen.getByTestId('health-records-layout-host');
    const layout = screen.getByTestId('health-records-layout');
    const reflow = async (width: number, direction: 'row' | 'column') => {
      bounds.set('health-records-layout-host', { x: 0, width });
      await fireEvent(host, 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width, height: 700 } },
      });
      expect(StyleSheet.flatten(layout.props.style)?.flexDirection).toBe(
        direction,
      );
    };

    await reflow(1400, 'column');
    await reflow(500, 'column');
    expect(heartRateFilterSelected()).toBe(true);
    expect(loadObservations).toHaveBeenCalledTimes(6);
    expect(screen.getByTestId('health-record-chart-heart_rate')).toBeTruthy();
  } finally {
    measure.mockRestore();
  }
});
