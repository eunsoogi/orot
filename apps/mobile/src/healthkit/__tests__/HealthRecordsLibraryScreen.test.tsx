import { fireEvent, render, screen } from '@testing-library/react-native';
import { mapBloodPressureCorrelation } from '../bloodPressure/mapper';
import { correlation } from '../bloodPressure/testSupport';
import {
  mapCommonObservationSample,
  toCommonObservationRecord,
} from '../commonObservations/mapper';
import { healthKitSample } from '../commonObservations/testSupport';
import { HealthRecordsLibraryScreen } from '../HealthRecordsLibraryScreen';
import {
  importedDoseEvent,
  medicationDefinition,
} from '../../../../../packages/storage/__tests__/localQueryTestSupport';

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
  expect(loadObservations).toHaveBeenCalledTimes(1);

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
