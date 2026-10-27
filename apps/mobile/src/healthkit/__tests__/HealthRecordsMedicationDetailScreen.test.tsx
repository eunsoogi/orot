import { fireEvent, render, screen } from '@testing-library/react-native';
import {
  importedDoseEvent,
  medicationDefinition,
} from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { HealthRecordsMedicationDetailScreen } from '../HealthRecordsMedicationDetailScreen';

test('shows saved dose events, exact status and period controls on a separate list screen', async () => {
  const timestamp = new Date().toISOString();
  const definition = medicationDefinition('medication-1', timestamp);
  const dose = importedDoseEvent('dose-1', timestamp, 'taken');
  const onSelectionChange = jest.fn();

  await render(
    <HealthRecordsMedicationDetailScreen
      loadMedicationData={async () => ({
        definitions: [definition],
        doseEvents: [dose],
      })}
      onBack={jest.fn()}
      onSelectionChange={onSelectionChange}
      selection={{ category: 'medications', period: 'month' }}
    />,
  );

  expect(
    await screen.findByTestId('health-records-medication-selected'),
  ).toHaveTextContent(/Synthetic medication/u);
  expect(
    screen.getByTestId('health-record-medication-row-0-status'),
  ).toHaveTextContent('복용함');
  expect(
    screen.getByTestId('health-record-medication-row-0-dose'),
  ).toHaveTextContent('1 tablet');
  await fireEvent.press(
    screen.getByTestId('health-record-period-three_months'),
  );
  expect(onSelectionChange).toHaveBeenCalledWith({
    category: 'medications',
    period: 'three_months',
  });
});

test('selects a medication history and shows its readable source without source IDs', async () => {
  const timestamp = new Date().toISOString();
  const secondDefinition = {
    ...medicationDefinition('medication-2', timestamp),
    displayText: 'Second medication',
    generalForm: 'capsule',
  };
  const secondDose = {
    ...importedDoseEvent('dose-2', timestamp, 'skipped'),
    medicationDefinitionId: 'medication-2',
    provenance: {
      origin: 'imported' as const,
      sourceRecordIds: ['source-private-record'],
      source: {
        system: 'healthkit',
        sourceIdentifier: 'private-source-identifier',
        sourceName: 'Synthetic pharmacy',
      },
    },
  };

  await render(
    <HealthRecordsMedicationDetailScreen
      loadMedicationData={async () => ({
        definitions: [
          medicationDefinition('medication-1', timestamp),
          secondDefinition,
        ],
        doseEvents: [
          importedDoseEvent('dose-1', timestamp, 'taken'),
          secondDose,
        ],
      })}
      onBack={jest.fn()}
      onSelectionChange={jest.fn()}
      selection={{ category: 'medications', period: 'month' }}
    />,
  );

  const secondOption = await screen.findByTestId(
    'health-record-medication-option-1',
  );
  await fireEvent.press(secondOption);

  expect(secondOption.props.accessibilityState.selected).toBe(true);
  expect(
    screen.getByTestId('health-records-medication-selected'),
  ).toHaveTextContent(/Second medication/u);
  expect(
    screen.getByTestId('health-record-medication-row-0-status'),
  ).toHaveTextContent('건너뜀');
  expect(
    screen.getByTestId('health-record-medication-row-0-source'),
  ).toHaveTextContent('출처: Synthetic pharmacy');
  expect(
    screen.queryByText(/private-source-identifier|source-private-record/u),
  ).toBeNull();
});

test('shows an empty period and recovers after a local read failure', async () => {
  const loadMedicationData = jest
    .fn()
    .mockRejectedValueOnce(new Error('local database unavailable'))
    .mockResolvedValueOnce({ definitions: [], doseEvents: [] });
  const props = {
    loadMedicationData,
    onBack: jest.fn(),
    onSelectionChange: jest.fn(),
    selection: { category: 'medications' as const, period: 'month' as const },
  };

  await render(<HealthRecordsMedicationDetailScreen {...props} />);
  expect(
    await screen.findByText('저장된 건강 기록을 불러오지 못했어요.'),
  ).toBeTruthy();
  await fireEvent.press(screen.getByTestId('health-records-detail-retry'));
  expect(
    await screen.findByTestId('health-records-detail-empty'),
  ).toHaveTextContent('선택한 기간에 기록이 없어요.');
});
