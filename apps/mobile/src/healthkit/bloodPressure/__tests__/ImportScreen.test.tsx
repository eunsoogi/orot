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
    onBack: jest.fn(),
  };
}

test('shows saved components, source details, and the unavailable original representation', async () => {
  const props = propsForScreen(persistedReadings());
  await render(<BloodPressureImportScreen {...props} />);

  expect(await screen.findByText('수축기 120 mmHg')).toBeTruthy();
  expect(screen.getByText('이완기 80 mmHg')).toBeTruthy();
  expect(screen.getAllByText('원본 정보 제공 안 됨')).toHaveLength(2);
  expect(screen.getAllByText('출처: Blood pressure monitor')).toHaveLength(2);
  expect(
    screen.getAllByText('측정 시각: 2026-10-02T12:34:56.123456789Z'),
  ).toHaveLength(2);
  expect(
    screen.getByTestId('blood-pressure-read-authorization'),
  ).toHaveTextContent('HealthKit 읽기 허용 여부는 앱에서 확인할 수 없어요.');
  expect(props.importBloodPressure).not.toHaveBeenCalled();
});

test('starts import only after the explicit action and reloads persisted readings', async () => {
  const readings = persistedReadings();
  const props = propsForScreen(
    [],
    jest.fn().mockResolvedValue(completed),
    jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(readings),
  );
  await render(<BloodPressureImportScreen {...props} />);
  expect(await screen.findByTestId('blood-pressure-empty')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('blood-pressure-import'));

  expect(props.importBloodPressure).toHaveBeenCalledTimes(1);
  expect(await screen.findByText('혈압 기록 변경을 가져왔어요.')).toBeTruthy();
  expect(await screen.findByText('수축기 120 mmHg')).toBeTruthy();
  expect(props.loadObservations).toHaveBeenCalledTimes(2);
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

  expect(await screen.findByText('수축기 120 mmHg')).toBeTruthy();
  expect(screen.getByText('원본 표현: 16 kPa')).toBeTruthy();
  expect(
    screen.queryByTestId('blood-pressure-reading-diastolic-0-card'),
  ).toBeNull();
  expect(screen.queryByTestId('blood-pressure-empty')).toBeNull();
});
