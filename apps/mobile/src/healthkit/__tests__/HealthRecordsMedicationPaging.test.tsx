import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { HealthRecordsMedicationDetailScreen } from '../HealthRecordsMedicationDetailScreen';
import { HealthRecordsLibraryScreen } from '../HealthRecordsLibraryScreen';
import { listHealthRecordMedicationData } from '../healthRecordsMedicationLibrary';
import {
  importedDoseEvent,
  medicationDefinition,
} from '../../../../../packages/storage/__tests__/localQueryTestSupport';

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
    <HealthRecordsLibraryScreen
      loadObservations={async () => ({ records: [], nextCursor: null })}
      onBack={jest.fn()}
      onOpenHealthImport={jest.fn()}
      onOpenDetail={jest.fn()}
      loadMedicationData={async () => ({
        definitions: [],
        doseEvents: [],
        totalDefinitions: 12,
        totalDoseEvents: 20000,
      })}
    />,
  );
  await fireEvent.press(screen.getByTestId('health-record-filter-all'));
  expect(screen.queryByTestId('health-records-empty')).toBeNull();
  await fireEvent.press(screen.getByTestId('health-record-filter-medications'));
  expect(await screen.findByText('12개 약 · 20000개 복용 기록')).toBeTruthy();
});

test('unloaded medication history stays pending and paging failure preserves rows until retry', async () => {
  const at = new Date().toISOString();
  const first = importedDoseEvent('first', at, 'taken');
  const later = {
    ...importedDoseEvent('later', at, 'skipped'),
    medicationDefinitionId: 'medication-2',
  };
  const definitions = [
    medicationDefinition('medication-1', at),
    medicationDefinition('medication-2', at),
  ];
  const cursor = { id: first.id, effectiveAt: at };
  let reject!: (error: Error) => void;
  const pending = new Promise((_resolve, fail) => {
    reject = fail;
  });
  const load = jest
    .fn()
    .mockResolvedValueOnce({
      definitions,
      doseEvents: [first],
      nextCursor: cursor,
    })
    .mockImplementationOnce(() => pending)
    .mockResolvedValueOnce({
      definitions: [],
      doseEvents: [later],
      nextCursor: null,
    });
  await render(
    <HealthRecordsMedicationDetailScreen
      loadMedicationData={load}
      onBack={jest.fn()}
      onSelectionChange={jest.fn()}
      selection={{ category: 'medications', period: 'month' }}
    />,
  );
  await fireEvent.press(
    screen.getByTestId('health-record-medication-option-1'),
  );
  expect(
    screen.queryByTestId('health-records-medication-history-empty'),
  ).toBeNull();
  expect(
    screen.getByTestId('health-records-medication-history-pending'),
  ).toBeTruthy();
  await fireEvent.press(
    screen.getByTestId('health-record-medication-option-0'),
  );
  await fireEvent.press(screen.getByTestId('health-records-detail-more'));
  expect(screen.getByTestId('health-records-detail-loading')).toBeTruthy();
  expect(screen.queryByTestId('health-records-detail-more')).toBeNull();
  expect(
    screen.getByTestId('health-record-medication-row-0-status'),
  ).toHaveTextContent('복용함');
  await act(async () => reject(new Error('page unavailable')));
  expect(screen.getByTestId('health-records-detail-error')).toHaveTextContent(
    '저장된 건강 기록을 불러오지 못했어요.',
  );
  expect(
    screen.getByTestId('health-record-medication-row-0-status'),
  ).toHaveTextContent('복용함');
  await fireEvent.press(
    screen.getByTestId('health-record-medication-option-1'),
  );
  await fireEvent.press(screen.getByTestId('health-records-detail-retry'));
  expect(load).toHaveBeenLastCalledWith(expect.objectContaining({ cursor }));
  expect(
    screen.getByTestId('health-record-medication-option-1').props
      .accessibilityState.selected,
  ).toBe(true);
  expect(
    await screen.findByTestId('health-record-medication-row-0-status'),
  ).toHaveTextContent('건너뜀');
});
