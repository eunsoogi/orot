import { act, render, screen } from '@testing-library/react-native';
import { importedDoseEvent } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { notifyLocalSourceDeleted } from '../../storage/localDataClearEvents';
import { HealthRecordsDetailScreen } from '../HealthRecordsDetailScreen';
import { HealthRecordsMedicationDetailScreen } from '../HealthRecordsMedicationDetailScreen';
import { mapBloodPressureCorrelation } from '../bloodPressure/mapper';
import { correlationAt } from '../bloodPressure/testSupport';

test('removes a deleted observation from open details even if rereading fails', async () => {
  const at = new Date().toISOString();
  const observations = mapBloodPressureCorrelation(
    correlationAt('deleted-pressure', at),
    at,
  ).observations;
  const load = jest
    .fn()
    .mockResolvedValueOnce({ records: observations, nextCursor: null })
    .mockRejectedValue(new Error('read failed'));
  await render(
    <HealthRecordsDetailScreen
      loadObservations={load}
      onBack={jest.fn()}
      onSelectionChange={jest.fn()}
      selection={{ category: 'blood_pressure', period: 'all' }}
    />,
  );
  await screen.findByTestId('health-record-row-0-systolic');
  await act(async () => notifyLocalSourceDeleted());
  expect(screen.queryByTestId('health-record-row-0-systolic')).toBeNull();
  expect(screen.queryByTestId('health-records-detail-empty')).toBeNull();
  expect(load).toHaveBeenCalledTimes(2);
});

test('removes a deleted dose from open medication history even if rereading fails', async () => {
  const dose = importedDoseEvent(
    'deleted-dose',
    new Date().toISOString(),
    'taken',
  );
  const load = jest
    .fn()
    .mockResolvedValueOnce({ definitions: [], doseEvents: [dose] })
    .mockRejectedValue(new Error('read failed'));
  await render(
    <HealthRecordsMedicationDetailScreen
      loadMedicationData={load}
      onBack={jest.fn()}
      onSelectionChange={jest.fn()}
      selection={{ category: 'medications', period: 'all' }}
    />,
  );
  await screen.findByTestId('health-record-medication-row-0-status');
  await act(async () => notifyLocalSourceDeleted());
  expect(
    screen.queryByTestId('health-record-medication-row-0-status'),
  ).toBeNull();
  expect(screen.queryByTestId('health-records-detail-empty')).toBeNull();
  expect(load).toHaveBeenCalledTimes(2);
});
