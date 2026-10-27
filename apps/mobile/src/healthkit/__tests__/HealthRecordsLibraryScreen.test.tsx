import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';
import { mapBloodPressureCorrelation } from '../bloodPressure/mapper';
import { correlation } from '../bloodPressure/testSupport';
import {
  mapCommonObservationSample,
  toCommonObservationRecord,
} from '../commonObservations/mapper';
import { healthKitSample } from '../commonObservations/testSupport';
import { HealthRecordsLibraryScreen } from '../HealthRecordsLibraryScreen';
import {
  healthObservation,
  importedDoseEvent,
  medicationDefinition,
} from '../../../../../packages/storage/__tests__/localQueryTestSupport';

const measurableView = View as unknown as {
  prototype: {
    measureInWindow: (
      callback: (x: number, y: number, width: number, height: number) => void,
    ) => void;
  };
};

test('shows imported pressure as a chart-first category and opens a separate period list', async () => {
  const observations = mapBloodPressureCorrelation(
    correlation('library-pressure'),
    '2026-10-05T10:00:00.000Z',
  ).observations;
  const loadObservations = jest.fn(async () => ({
    records: observations,
    nextCursor: null,
  }));
  const onBack = jest.fn();
  const onOpenDetail = jest.fn();

  await render(
    <HealthRecordsLibraryScreen
      loadObservations={loadObservations}
      onBack={onBack}
      onOpenHealthImport={jest.fn()}
      onOpenDetail={onOpenDetail}
    />,
  );

  expect(
    await screen.findByTestId('health-record-category-blood_pressure'),
  ).toBeTruthy();
  expect(screen.getByTestId('health-record-category-heart_rate')).toBeTruthy();
  expect(
    screen.getByTestId('health-record-category-empty-heart_rate'),
  ).toHaveTextContent('저장된 심박수 기록이 없어요.');
  const chart = screen.getByTestId('health-record-chart-blood_pressure');
  expect(chart.props.accessibilityRole).toBe('image');
  expect(chart.props.accessibilityLabel).toContain('120 mmHg');
  expect(chart.props.accessibilityLabel).toContain('80 mmHg');
  expect(screen.queryByText(chart.props.accessibilityLabel)).toBeNull();
  expect(loadObservations).toHaveBeenCalledTimes(6);

  await fireEvent.press(
    screen.getByTestId('health-record-open-detail-blood_pressure'),
  );
  expect(onOpenDetail).toHaveBeenCalledWith({
    category: 'blood_pressure',
    period: 'month',
  });
  expect(screen.queryByText('library-pressure')).toBeNull();
});

test('keeps other record types visible when a filter selects its chart first', async () => {
  const timestamp = '2026-10-05T10:00:00.000Z';
  const pressure = mapBloodPressureCorrelation(
    correlation('filtered-pressure'),
    timestamp,
  ).observations;
  const mappedHeartRate = mapCommonObservationSample(
    'heartRate',
    healthKitSample('heartRate', {
      id: 'filtered-heart-rate',
      startDate: timestamp,
      endDate: timestamp,
    }),
  );
  if (mappedHeartRate.status !== 'mapped') {
    throw new Error('Expected a mapped synthetic heart-rate observation.');
  }
  const heartRate = toCommonObservationRecord(
    mappedHeartRate.observation,
    timestamp,
  );

  await render(
    <HealthRecordsLibraryScreen
      loadObservations={async () => ({
        records: [...pressure, heartRate],
        nextCursor: null,
      })}
      onBack={jest.fn()}
      onOpenHealthImport={jest.fn()}
      onOpenDetail={jest.fn()}
    />,
  );

  await fireEvent.press(screen.getByTestId('health-record-filter-heart_rate'));
  expect(
    await screen.findByTestId('health-record-category-heart_rate'),
  ).toBeTruthy();
  expect(
    screen.getByTestId('health-record-category-blood_pressure'),
  ).toBeTruthy();
});

test('shows stored HealthKit medication counts and opens its separate detail list', async () => {
  const timestamp = new Date().toISOString();
  const medication = medicationDefinition('medication-1', timestamp);
  const dose = importedDoseEvent('dose-1', timestamp, 'taken');
  const onOpenDetail = jest.fn();

  await render(
    <HealthRecordsLibraryScreen
      loadMedicationData={async () => ({
        definitions: [medication],
        doseEvents: [dose],
      })}
      loadObservations={async () => ({ records: [], nextCursor: null })}
      onBack={jest.fn()}
      onOpenHealthImport={jest.fn()}
      onOpenDetail={onOpenDetail}
    />,
  );

  expect(
    await screen.findByTestId('health-record-medications-count'),
  ).toHaveTextContent('1개 약 · 1개 복용 기록');
  await fireEvent.press(
    screen.getByTestId('health-record-open-detail-medications'),
  );
  expect(onOpenDetail).toHaveBeenCalledWith({
    category: 'medications',
    period: 'month',
  });
});

test('recovers the medication summary after a local read failure', async () => {
  const loadMedicationData = jest
    .fn()
    .mockRejectedValueOnce(new Error('local database unavailable'))
    .mockResolvedValueOnce({ definitions: [], doseEvents: [] });

  await render(
    <HealthRecordsLibraryScreen
      loadMedicationData={loadMedicationData}
      loadObservations={async () => ({ records: [], nextCursor: null })}
      onBack={jest.fn()}
      onOpenHealthImport={jest.fn()}
      onOpenDetail={jest.fn()}
    />,
  );

  expect(
    await screen.findByTestId('health-record-medications-summary'),
  ).toHaveTextContent('저장된 건강 기록을 불러오지 못했어요.');
  await fireEvent.press(screen.getByTestId('health-record-medications-retry'));
  expect(
    await screen.findByTestId('health-record-medications-summary'),
  ).toHaveTextContent('저장된 약 및 복용 기록이 없어요.');
  expect(loadMedicationData).toHaveBeenCalledTimes(2);
});

test('opens unified import from the health records library action', async () => {
  const onOpenHealthImport = jest.fn();
  await render(
    <HealthRecordsLibraryScreen
      loadObservations={async () => ({ records: [], nextCursor: null })}
      onBack={jest.fn()}
      onOpenHealthImport={onOpenHealthImport}
      onOpenDetail={jest.fn()}
    />,
  );

  await fireEvent.press(
    await screen.findByTestId('health-records-open-health-import'),
  );
  expect(onOpenHealthImport).toHaveBeenCalledTimes(1);
});

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
    await screen.findByTestId('health-record-chart-heart_rate');
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

    await reflow(1400, 'row');
    await reflow(500, 'column');
    expect(heartRateFilterSelected()).toBe(true);
    expect(loadObservations).toHaveBeenCalledTimes(6);
    expect(screen.getByTestId('health-record-chart-heart_rate')).toBeTruthy();
  } finally {
    measure.mockRestore();
  }
});
