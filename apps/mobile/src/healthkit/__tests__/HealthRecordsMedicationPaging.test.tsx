import { fireEvent, render, screen } from '@testing-library/react-native';
import { HealthRecordsMedicationDetailScreen } from '../HealthRecordsMedicationDetailScreen';
import { HealthRecordsMedicationCategoryCard } from '../HealthRecordsMedicationCategoryCard';
import { listHealthRecordMedicationData } from '../healthRecordsMedicationLibrary';
import { importedDoseEvent } from '../../../../../packages/storage/__tests__/localQueryTestSupport';

test('production medication reads use a bounded page instead of loading the full history', async () => {
  const list = jest.fn().mockRejectedValue(new Error('Unbounded history read'));
  const listHealthMedicationPage = jest.fn().mockResolvedValue({
    definitions: [],
    doseEvents: [],
    nextCursor: null,
    totalDefinitions: 0,
    totalDoseEvents: 0,
  });
  await listHealthRecordMedicationData({
    list,
    listHealthMedicationPage,
  } as never);
  expect(list).not.toHaveBeenCalled();
  expect(listHealthMedicationPage).toHaveBeenCalledWith(
    expect.objectContaining({ includeTotals: true }),
  );
});

test('medication detail requests the selected period and appends its next page', async () => {
  const timestamp = new Date().toISOString();
  const first = importedDoseEvent('dose-first', timestamp, 'taken');
  const second = importedDoseEvent('dose-second', timestamp, 'taken');
  const cursor = { effectiveAt: timestamp, id: first.id };
  const loadMedicationData = jest
    .fn()
    .mockResolvedValueOnce({
      definitions: [],
      doseEvents: [first],
      nextCursor: cursor,
    })
    .mockResolvedValueOnce({
      definitions: [],
      doseEvents: [second],
      nextCursor: null,
    });
  await render(
    <HealthRecordsMedicationDetailScreen
      loadMedicationData={loadMedicationData}
      onBack={jest.fn()}
      onSelectionChange={jest.fn()}
      selection={{ category: 'medications', period: 'month' }}
    />,
  );
  await screen.findByTestId('health-record-medication-row-0-status');
  expect(loadMedicationData).toHaveBeenCalledWith(
    expect.objectContaining({
      fromInclusive: expect.any(String),
      toInclusive: expect.any(String),
      cursor: null,
    }),
  );
  await fireEvent(
    screen.getByTestId('health-records-detail-scroll'),
    'onEndReached',
  );
  await screen.findByTestId('health-record-medication-row-1-status');
  expect(loadMedicationData).toHaveBeenLastCalledWith(
    expect.objectContaining({ cursor }),
  );
});

test('medication overview shows scalar totals rather than the bounded sample size', async () => {
  await render(
    <HealthRecordsMedicationCategoryCard
      onOpenDetail={jest.fn()}
      loadMedicationData={async () => ({
        definitions: [],
        doseEvents: [],
        totalDefinitions: 12,
        totalDoseEvents: 20000,
      })}
    />,
  );
  expect(await screen.findByText('12개 약 · 20000개 복용 기록')).toBeTruthy();
});
