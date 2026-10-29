import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import type { HealthObservationPageLoader } from '@orot/storage';
import { mapBloodPressureCorrelation } from '../bloodPressure/mapper';
import { correlation } from '../bloodPressure/testSupport';
import { HealthRecordsDetailScreen } from '../HealthRecordsDetailScreen';
import type { HealthRecordPeriod } from '../healthRecordsLibraryModel';

// Period filtering uses the app's Date constructor, so keep test time fixed too.
const healthRecordReferenceTime = '2035-06-15T12:00:00.000Z';

afterEach(() => {
  jest.useRealTimers();
});

test('stacks date and pressure values at accessibility text sizes', async () => {
  const original = Dimensions.get('window');
  Dimensions.set({ window: { ...original, width: 402, fontScale: 2 } });
  const observations = mapBloodPressureCorrelation(
    correlation('large-pressure'),
    new Date().toISOString(),
  ).observations;
  await render(
    <HealthRecordsDetailScreen
      loadObservations={async () => ({
        records: observations,
        nextCursor: null,
      })}
      onBack={jest.fn()}
      onSelectionChange={jest.fn()}
      selection={{ category: 'blood_pressure', period: 'all' }}
    />,
  );
  expect(screen.getByTestId('health-record-row-0-columns')).toHaveStyle({
    flexDirection: 'column',
    alignItems: 'stretch',
  });
  expect(
    screen.getByTestId('health-record-row-0-systolic').props.accessibilityLabel,
  ).toBe('수축기 120 mmHg');
  await act(() => Dimensions.set({ window: original }));
});

test('shows the selected period as paired source values with exact units', async () => {
  jest.useFakeTimers({ now: Date.parse(healthRecordReferenceTime) });
  const observations = mapBloodPressureCorrelation(
    correlation('detail-pressure'),
    healthRecordReferenceTime,
  ).observations.map(item => ({
    ...item,
    effectiveAt: healthRecordReferenceTime,
  }));
  const loadObservations = jest.fn(async () => ({
    records: observations,
    nextCursor: null,
  }));
  const onSelectionChange = jest.fn();

  await render(
    <HealthRecordsDetailScreen
      loadObservations={loadObservations}
      onBack={jest.fn()}
      onSelectionChange={onSelectionChange}
      selection={{ category: 'blood_pressure', period: 'month' }}
    />,
  );

  expect(await screen.findByTestId('health-record-row-0')).toBeTruthy();
  expect(
    screen.getByTestId('health-record-row-0-systolic').props.accessibilityLabel,
  ).toBe('수축기 120 mmHg');
  expect(
    screen.getByTestId('health-record-row-0-diastolic').props
      .accessibilityLabel,
  ).toBe('이완기 80 mmHg');
  expect(
    screen.getByTestId('health-record-period-month').props.accessibilityState,
  ).toMatchObject({ selected: true });

  await fireEvent.press(screen.getByTestId('health-record-period-all'));
  expect(onSelectionChange).toHaveBeenCalledWith({
    category: 'blood_pressure',
    period: 'all',
  });
});

// Counts describe loaded rows until the selected period has no remaining pages.
test('shows a partial period immediately and appends the next page on demand', async () => {
  const now = new Date().toISOString();
  const observations = mapBloodPressureCorrelation(
    correlation('paged-pressure'),
    now,
  ).observations.map(item => ({ ...item, effectiveAt: now }));
  const cursor = { id: observations[0]!.id, effectiveAt: now };
  const loadObservations = jest
    .fn()
    .mockResolvedValueOnce({
      records: observations.slice(0, 1),
      nextCursor: cursor,
    })
    .mockResolvedValueOnce({
      records: observations.slice(1),
      nextCursor: null,
    });
  await render(
    <HealthRecordsDetailScreen
      loadObservations={loadObservations}
      onBack={jest.fn()}
      onSelectionChange={jest.fn()}
      selection={{ category: 'blood_pressure', period: 'month' }}
    />,
  );
  expect(loadObservations).toHaveBeenCalledTimes(1);
  expect(screen.getByText('불러온 1개 기록')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('health-records-load-older'));
  expect(loadObservations).toHaveBeenCalledTimes(2);
  expect(
    screen.getByTestId('health-record-row-0-systolic').props.accessibilityLabel,
  ).toBe('수축기 120 mmHg');
  expect(
    screen.getByTestId('health-record-row-0-diastolic').props
      .accessibilityLabel,
  ).toBe('이완기 80 mmHg');
  expect(screen.queryByTestId('health-records-load-older')).toBeNull();
});

// An empty category on one page must neither claim absence nor drain the database.
test('keeps an empty page reachable without automatically scanning remaining history', async () => {
  const now = new Date().toISOString();
  const observations = mapBloodPressureCorrelation(
    correlation('later-pressure'),
    now,
  ).observations.map(item => ({ ...item, effectiveAt: now }));
  const cursor = { id: 'first-page', effectiveAt: now };
  const loadObservations = jest
    .fn()
    .mockResolvedValueOnce({ records: [], nextCursor: cursor })
    .mockRejectedValueOnce(new Error('Read failed'))
    .mockResolvedValueOnce({ records: observations, nextCursor: null });
  await render(
    <HealthRecordsDetailScreen
      loadObservations={loadObservations}
      onBack={jest.fn()}
      onSelectionChange={jest.fn()}
      selection={{ category: 'blood_pressure', period: 'month' }}
    />,
  );
  expect(loadObservations).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('health-records-detail-empty')).toBeNull();
  await fireEvent.press(screen.getByTestId('health-records-load-older'));
  await fireEvent.press(screen.getByTestId('health-records-detail-retry'));
  expect(loadObservations).toHaveBeenLastCalledWith(
    cursor,
    expect.objectContaining({ category: 'blood_pressure' }),
  );
  expect(screen.getByTestId('health-record-row-0')).toBeTruthy();
  expect(screen.queryByTestId('health-records-load-older')).toBeNull();
});

test('keeps the period and loaded rows while detail panels reflow', async () => {
  jest.useFakeTimers({ now: Date.parse(healthRecordReferenceTime) });
  const original = Dimensions.get('window');
  const observations = mapBloodPressureCorrelation(
    correlation('detail-reflow'),
    healthRecordReferenceTime,
  ).observations.map(item => ({
    ...item,
    effectiveAt: healthRecordReferenceTime,
  }));
  const loadObservations = jest.fn(async () => ({
    records: observations,
    nextCursor: null,
  }));
  Dimensions.set({ window: { ...original, width: 900, fontScale: 1 } });

  try {
    await render(
      <StatefulHealthRecordsDetailScreen loadObservations={loadObservations} />,
    );
    const layout = screen.getByTestId('health-records-detail-layout');
    const direction = () =>
      StyleSheet.flatten(layout.props.style)?.flexDirection;

    expect(direction()).toBe('column');
    expect(screen.getByTestId('health-record-row-0-time')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('health-record-period-year'));
    expect(
      screen.getByTestId('health-record-period-year').props.accessibilityState,
    ).toMatchObject({ selected: true });

    await act(() =>
      Dimensions.set({ window: { ...original, width: 500, fontScale: 1 } }),
    );
    expect(direction()).toBe('column');
    expect(
      screen.getByTestId('health-record-period-year').props.accessibilityState,
    ).toMatchObject({ selected: true });
    expect(screen.getByTestId('health-record-row-0-time')).toBeTruthy();
    expect(loadObservations).toHaveBeenCalledTimes(2);
  } finally {
    await act(() => Dimensions.set({ window: original }));
  }
});

function StatefulHealthRecordsDetailScreen({
  loadObservations,
}: {
  readonly loadObservations: HealthObservationPageLoader;
}) {
  const [selection, setSelection] = useState<{
    readonly category: 'blood_pressure';
    readonly period: HealthRecordPeriod;
  }>({
    category: 'blood_pressure',
    period: 'month',
  });

  return (
    <HealthRecordsDetailScreen
      loadObservations={loadObservations}
      onBack={jest.fn()}
      onSelectionChange={next =>
        setSelection(current => ({ ...current, period: next.period }))
      }
      selection={selection}
    />
  );
}
