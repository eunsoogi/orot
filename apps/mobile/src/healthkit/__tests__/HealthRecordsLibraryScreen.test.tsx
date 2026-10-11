import { fireEvent, render, screen } from '@testing-library/react-native';
import { mapBloodPressureCorrelation } from '../bloodPressure/mapper';
import { correlation } from '../bloodPressure/testSupport';
import {
  mapCommonObservationSample,
  toCommonObservationRecord,
} from '../commonObservations/mapper';
import { healthKitSample } from '../commonObservations/testSupport';
import { HealthRecordsLibraryScreen } from '../HealthRecordsLibraryScreen';

test('shows saved observation values in the records library and supports Back', async () => {
  const mapped = mapCommonObservationSample(
    'heartRate',
    healthKitSample('heartRate'),
  );
  if (mapped.status !== 'mapped') {
    throw new Error('The synthetic heart-rate sample must map.');
  }
  const commonObservation = toCommonObservationRecord(
    mapped.observation,
    '2026-10-05T10:00:00.000Z',
  );
  const pressureObservations = mapBloodPressureCorrelation(
    correlation('library-pressure'),
    '2026-10-05T10:00:00.000Z',
  ).observations;
  const loadObservations = jest.fn(async () => [
    commonObservation,
    ...pressureObservations,
  ]);
  const onBack = jest.fn();

  await render(
    <HealthRecordsLibraryScreen
      loadObservations={loadObservations}
      onBack={onBack}
    />,
  );

  expect(await screen.findByText('심박수')).toBeTruthy();
  expect(screen.getByText('72 count/min')).toBeTruthy();
  expect(screen.getByText('수축기')).toBeTruthy();
  expect(screen.getByText('120 mmHg')).toBeTruthy();
  expect(loadObservations).toHaveBeenCalledTimes(1);

  await fireEvent.press(screen.getByTestId('health-records-back'));
  expect(onBack).toHaveBeenCalledTimes(1);
});
