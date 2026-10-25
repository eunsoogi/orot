import { fireEvent, render, screen } from '@testing-library/react-native';
import { BloodPressureImportScreen } from '../BloodPressureImportScreen';
import { mapBloodPressureCorrelation } from '../mapper';
import { correlation } from '../testSupport';
import type {
  BloodPressureObservation,
  BloodPressureSyncResult,
} from '../types';

const persistedReadings = () =>
  mapBloodPressureCorrelation(
    correlation('screen-correlation'),
    '2026-10-05T10:00:00.000Z',
  ).observations;

const completed: BloodPressureSyncResult = {
  status: 'completed',
  readAuthorization: 'notObservable',
  upserted: 2,
  deleted: 0,
  cursorAdvanced: true,
};

function propsForScreen(
  observations: readonly BloodPressureObservation[],
  importBloodPressure = jest.fn().mockResolvedValue(completed),
  loadObservations = jest.fn().mockResolvedValue(observations),
) {
  return {
    importBloodPressure,
    loadObservations,
    onOpenLibrary: jest.fn(),
    onBack: jest.fn(),
  };
}

test('keeps saved components in the records library instead of the import result', async () => {
  const props = propsForScreen(persistedReadings());
  await render(<BloodPressureImportScreen {...props} />);

  expect(await screen.findByTestId('blood-pressure-status')).toBeTruthy();
  expect(
    screen.queryByTestId('blood-pressure-reading-systolic-0-card'),
  ).toBeNull();
  expect(props.loadObservations).not.toHaveBeenCalled();
  expect(
    screen.getByTestId('blood-pressure-read-authorization'),
  ).toHaveTextContent('HealthKit 읽기 허용 여부는 앱에서 확인할 수 없어요.');
  expect(props.importBloodPressure).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByTestId('blood-pressure-open-library'));
  expect(props.onOpenLibrary).toHaveBeenCalledTimes(1);
});

test('shows the real import outcome hierarchy and library action after import', async () => {
  const readings = persistedReadings();
  const props = propsForScreen(
    [],
    jest.fn().mockResolvedValue(completed),
    jest.fn().mockResolvedValue(readings),
  );
  await render(<BloodPressureImportScreen {...props} />);
  expect(await screen.findByTestId('blood-pressure-status')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('blood-pressure-import'));

  expect(props.importBloodPressure).toHaveBeenCalledTimes(1);
  expect(
    await screen.findByTestId('blood-pressure-import-completion'),
  ).toBeTruthy();
  expect(await screen.findByText('가져오기가 끝났어요')).toBeTruthy();
  expect(
    screen.getByTestId('blood-pressure-result-saved-count'),
  ).toHaveTextContent('2개');
  expect(
    screen.getByTestId('blood-pressure-result-deleted-count'),
  ).toHaveTextContent('0개');
  expect(
    screen.queryByTestId('blood-pressure-reading-systolic-0-card'),
  ).toBeNull();
  expect(props.loadObservations).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByTestId('blood-pressure-open-library'));
  expect(props.onOpenLibrary).toHaveBeenCalledTimes(1);
});

test('keeps an empty HealthKit query distinct from permission status', async () => {
  const props = propsForScreen(
    [],
    jest.fn().mockResolvedValue({ ...completed, upserted: 0, deleted: 0 }),
  );
  await render(<BloodPressureImportScreen {...props} />);

  await fireEvent.press(screen.getByTestId('blood-pressure-import'));

  expect(await screen.findByText('새로 반영된 기록이 없어요')).toBeTruthy();
  expect(
    screen.getByTestId('blood-pressure-result-saved-count'),
  ).toHaveTextContent('0개');
  expect(
    screen.getByTestId('blood-pressure-read-authorization'),
  ).toHaveTextContent('HealthKit 읽기 허용 여부는 앱에서 확인할 수 없어요.');
});

test('shows partial outcome counts and keeps the retry action available', async () => {
  const partial: BloodPressureSyncResult = {
    ...completed,
    status: 'partial',
    upserted: 1,
    cursorAdvanced: false,
  };
  const props = propsForScreen([], jest.fn().mockResolvedValue(partial));
  await render(<BloodPressureImportScreen {...props} />);

  await fireEvent.press(screen.getByTestId('blood-pressure-import'));

  expect(await screen.findByText('일부 변경 사항만 반영했어요')).toBeTruthy();
  expect(
    screen.getByTestId('blood-pressure-result-saved-count'),
  ).toHaveTextContent('1개');
  await fireEvent.press(screen.getByTestId('blood-pressure-import-again'));
  expect(props.importBloodPressure).toHaveBeenCalledTimes(2);
});

test('keeps a failed import retryable without inventing result counts', async () => {
  const importBloodPressure = jest
    .fn()
    .mockRejectedValueOnce(new Error('HealthKit query failed'))
    .mockResolvedValueOnce(completed);
  const props = propsForScreen([], importBloodPressure);
  await render(<BloodPressureImportScreen {...props} />);

  await fireEvent.press(screen.getByTestId('blood-pressure-import'));

  expect(await screen.findByText('가져오기를 완료하지 못했어요')).toBeTruthy();
  expect(screen.queryByTestId('blood-pressure-result-summary')).toBeNull();
  await fireEvent.press(screen.getByTestId('blood-pressure-import-again'));
  expect(
    await screen.findByTestId('blood-pressure-result-saved-count'),
  ).toHaveTextContent('2개');
  expect(importBloodPressure).toHaveBeenCalledTimes(2);
});

test('shows an unavailable outcome without inferring an authorization denial', async () => {
  const props = propsForScreen(
    [],
    jest.fn().mockResolvedValue({ ...completed, status: 'notRun' }),
  );
  await render(<BloodPressureImportScreen {...props} />);

  await fireEvent.press(screen.getByTestId('blood-pressure-import'));

  expect(await screen.findByText('가져오기를 시작할 수 없어요')).toBeTruthy();
  expect(screen.queryByTestId('blood-pressure-result-summary')).toBeNull();
  expect(
    screen.getByTestId('blood-pressure-read-authorization'),
  ).toHaveTextContent('HealthKit 읽기 허용 여부는 앱에서 확인할 수 없어요.');
});

test('renders an explicitly supplied original pair and never invents a missing component', async () => {
  const systolic = persistedReadings().find(
    observation => observation.concept === 'blood pressure systolic',
  );
  if (!systolic || systolic.value.kind !== 'quantity') {
    throw new Error('The systolic fixture must be a quantity.');
  }
  const withOriginalPair: BloodPressureObservation = {
    ...systolic,
    value: {
      ...systolic.value,
      sourceRepresentation: { status: 'available', amount: 16, unit: 'kPa' },
    },
  };
  const props = propsForScreen([withOriginalPair]);
  await render(<BloodPressureImportScreen {...props} />);

  expect(await screen.findByTestId('blood-pressure-status')).toBeTruthy();
  expect(screen.queryByText('수축기 120 mmHg')).toBeNull();
  expect(props.loadObservations).not.toHaveBeenCalled();
});
