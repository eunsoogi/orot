import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { HealthObservationPage } from '@orot/storage';
import { HealthRecordsLibraryScreen } from '../HealthRecordsLibraryScreen';
import { mapBloodPressureCorrelation } from '../bloodPressure/mapper';
import { correlation } from '../bloodPressure/testSupport';
import {
  mapCommonObservationSample,
  toCommonObservationRecord,
} from '../commonObservations/mapper';
import { healthKitSample } from '../commonObservations/testSupport';
import { NavigationLeaveStateRegistrationProvider } from '../../navigation/useNavigationLeaveStateRegistration';
import type { NavigationLeaveStateRegistration } from '../../navigation/useNavigationLeaveStateRegistration';

function deferred() {
  let resolve!: (page: HealthObservationPage) => void;
  const promise = new Promise<HealthObservationPage>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

test('shows the first page before requesting more current-period records', async () => {
  const now = Date.now();
  const recentHeartRates = Array.from({ length: 50 }, (_, index) => {
    const timestamp = new Date(now - (index + 1) * 60_000).toISOString();
    const mapped = mapCommonObservationSample(
      'heartRate',
      healthKitSample('heartRate', {
        id: `summary-heart-rate-${index}`,
        startDate: timestamp,
        endDate: timestamp,
      }),
    );
    if (mapped.status !== 'mapped') {
      throw new Error('Expected a mapped synthetic heart-rate observation.');
    }
    return toCommonObservationRecord(mapped.observation, timestamp);
  });
  const pressureAt = new Date(now - 51 * 60_000).toISOString();
  const pressure = mapBloodPressureCorrelation(
    correlation('summary-pressure'),
    pressureAt,
  ).observations;
  const olderAt = new Date(now - 62 * 24 * 60 * 60_000).toISOString();
  const olderMapped = mapCommonObservationSample(
    'heartRate',
    healthKitSample('heartRate', {
      id: 'summary-older-heart-rate',
      startDate: olderAt,
      endDate: olderAt,
    }),
  );
  if (olderMapped.status !== 'mapped') {
    throw new Error(
      'Expected a mapped synthetic older heart-rate observation.',
    );
  }
  const older = toCommonObservationRecord(olderMapped.observation, olderAt);
  const firstCursor = {
    effectiveAt: recentHeartRates.at(-1)!.effectiveAt,
    id: recentHeartRates.at(-1)!.id,
  };
  const olderCursor = { effectiveAt: older.effectiveAt, id: older.id };
  const loader = jest.fn(async (cursor: { id: string } | null) => {
    if (!cursor) return { records: recentHeartRates, nextCursor: firstCursor };
    if (cursor.id === firstCursor.id) {
      return { records: [...pressure, older], nextCursor: olderCursor };
    }
    return { records: [], nextCursor: null };
  });

  await render(
    <HealthRecordsLibraryScreen
      loadObservations={loader}
      onBack={jest.fn()}
      onOpenDetail={jest.fn()}
    />,
  );

  // A dense current month must not delay first paint until every page arrives.
  expect(loader).toHaveBeenCalledTimes(1);
  expect(screen.getByText('아직 불러오지 않은 기록이 있어요.')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('health-records-load-older'));
  expect(
    await screen.findByTestId('health-record-chart-blood_pressure'),
  ).toBeTruthy();
  expect(loader).toHaveBeenCalledTimes(2);
  await fireEvent(screen.getByTestId('health-records-scroll'), 'endReached');
  expect(loader).toHaveBeenCalledTimes(3);
  expect(loader).toHaveBeenLastCalledWith(olderCursor);
});

test('a pending library read registers safe leave state', async () => {
  const request = deferred();
  const register = jest.fn<
    ReturnType<NavigationLeaveStateRegistration>,
    Parameters<NavigationLeaveStateRegistration>
  >(() => () => {});
  await render(
    <NavigationLeaveStateRegistrationProvider registerLeaveState={register}>
      <HealthRecordsLibraryScreen
        loadObservations={() => request.promise}
        onBack={jest.fn()}
        onOpenDetail={jest.fn()}
      />
    </NavigationLeaveStateRegistrationProvider>,
  );
  expect(screen.getByTestId('health-records-loading')).toBeTruthy();
  const source = register.mock.calls[register.mock.calls.length - 1]?.[0];
  expect(source?.readState()).toMatchObject({
    canLeave: true,
    hasUnsavedChanges: false,
    hasOngoingOperation: false,
  });
  await act(async () => request.resolve({ records: [], nextCursor: null }));
});

test('late loader responses cannot overwrite a new library request', async () => {
  const old = deferred();
  const current = deferred();
  const view = await render(
    <HealthRecordsLibraryScreen
      loadObservations={() => old.promise}
      onBack={jest.fn()}
      onOpenDetail={jest.fn()}
    />,
  );
  await view.rerender(
    <HealthRecordsLibraryScreen
      loadObservations={() => current.promise}
      onBack={jest.fn()}
      onOpenDetail={jest.fn()}
    />,
  );
  await act(async () => current.resolve({ records: [], nextCursor: null }));
  await act(async () =>
    old.resolve({
      records: [],
      nextCursor: { id: 'stale', effectiveAt: '2026-10-01T00:00:00Z' },
    }),
  );
  expect(
    screen.getByTestId('health-record-category-empty-heart_rate'),
  ).toHaveTextContent('저장된 심박수 기록이 없어요.');
  expect(screen.queryByTestId('health-records-loading')).toBeNull();
});

test('coalesces repeated end events while the next page is pending', async () => {
  const next = deferred();
  const cursor = { id: 'cursor', effectiveAt: '2026-10-01T00:00:00Z' };
  const loader = jest
    .fn()
    .mockResolvedValueOnce({ records: [], nextCursor: cursor })
    .mockImplementation(() => next.promise);
  await render(
    <HealthRecordsLibraryScreen
      loadObservations={loader}
      onBack={jest.fn()}
      onOpenDetail={jest.fn()}
    />,
  );
  await fireEvent(screen.getByTestId('health-records-scroll'), 'endReached');
  await fireEvent(screen.getByTestId('health-records-scroll'), 'endReached');
  expect(loader).toHaveBeenCalledTimes(2);
  expect(loader).toHaveBeenLastCalledWith(cursor);
  await act(async () => next.resolve({ records: [], nextCursor: null }));
});
