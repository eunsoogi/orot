import { act, render, screen, fireEvent } from '@testing-library/react-native';
import type {
  HealthObservationPageFilter,
  HealthObservationPage,
} from '@orot/storage';
import { HealthRecordsLibraryScreen } from '../HealthRecordsLibraryScreen';
import { HealthRecordsDetailScreen } from '../HealthRecordsDetailScreen';
import { mapBloodPressureCorrelation } from '../bloodPressure/mapper';
import { correlation } from '../bloodPressure/testSupport';

test('loads each category directly and shows pressure while a Watch category remains pending', async () => {
  const pressure = mapBloodPressureCorrelation(
    correlation('scoped-pressure'),
    new Date().toISOString(),
  ).observations;
  let finishHeart!: (page: HealthObservationPage) => void;
  const heart = new Promise<HealthObservationPage>(resolve => {
    finishHeart = resolve;
  });
  const loader = jest.fn(
    async (_cursor, filter?: HealthObservationPageFilter) => {
      if (filter?.category === 'heart_rate') return heart;
      return {
        records: filter?.category === 'blood_pressure' ? pressure : [],
        nextCursor: null,
      };
    },
  );
  await render(
    <HealthRecordsLibraryScreen
      loadObservations={loader}
      onBack={jest.fn()}
      onOpenDetail={jest.fn()}
    />,
  );
  expect(loader).toHaveBeenCalledWith(
    null,
    expect.objectContaining({
      category: 'blood_pressure',
      fromInclusive: expect.any(String),
      toInclusive: expect.any(String),
    }),
  );
  expect(loader).toHaveBeenCalledTimes(6);
  expect(
    await screen.findByTestId('health-record-chart-blood_pressure'),
  ).toBeTruthy();
  expect(
    screen.getByTestId('health-record-category-empty-heart_rate'),
  ).toHaveTextContent('저장된 건강 기록을 불러오는 중…');
  await fireEvent.press(screen.getByTestId('health-record-filter-sleep'));
  expect(loader).toHaveBeenCalledTimes(6);
  await act(async () => finishHeart({ records: [], nextCursor: null }));
});

test('detail pages pass the selected category and period on every bounded request', async () => {
  const at = new Date().toISOString();
  const pressure = mapBloodPressureCorrelation(
    correlation('scoped-detail'),
    at,
  ).observations;
  const cursor = { effectiveAt: pressure[0]!.effectiveAt, id: pressure[0]!.id };
  const loader = jest
    .fn()
    .mockResolvedValueOnce({ records: pressure, nextCursor: cursor })
    .mockResolvedValueOnce({ records: [], nextCursor: null });
  await render(
    <HealthRecordsDetailScreen
      loadObservations={loader}
      onBack={jest.fn()}
      onSelectionChange={jest.fn()}
      selection={{ category: 'blood_pressure', period: 'month' }}
    />,
  );
  expect(loader).toHaveBeenCalledWith(
    null,
    expect.objectContaining({
      category: 'blood_pressure',
      fromInclusive: expect.any(String),
    }),
  );
  await fireEvent.press(screen.getByTestId('health-records-load-older'));
  expect(loader).toHaveBeenLastCalledWith(cursor, loader.mock.calls[0][1]);
});

test('retries only the failed category while retaining the ready pressure card', async () => {
  const pressure = mapBloodPressureCorrelation(
    correlation('ready-pressure'),
    new Date().toISOString(),
  ).observations;
  let failHeart = true;
  const loader = jest.fn(
    async (_cursor, filter?: HealthObservationPageFilter) => {
      if (filter?.category === 'heart_rate' && failHeart)
        throw new Error('Synthetic category failure');
      return {
        records: filter?.category === 'blood_pressure' ? pressure : [],
        nextCursor: null,
      };
    },
  );
  await render(
    <HealthRecordsLibraryScreen
      loadObservations={loader}
      onBack={jest.fn()}
      onOpenDetail={jest.fn()}
    />,
  );
  expect(
    await screen.findByTestId('health-record-chart-blood_pressure'),
  ).toBeTruthy();
  await fireEvent.press(screen.getByTestId('health-record-filter-heart_rate'));
  failHeart = false;
  await fireEvent.press(screen.getByTestId('health-records-retry'));
  expect(loader).toHaveBeenCalledTimes(7);
  expect(loader).toHaveBeenLastCalledWith(
    null,
    expect.objectContaining({ category: 'heart_rate' }),
  );
  expect(screen.getByTestId('health-record-chart-blood_pressure')).toBeTruthy();
});
