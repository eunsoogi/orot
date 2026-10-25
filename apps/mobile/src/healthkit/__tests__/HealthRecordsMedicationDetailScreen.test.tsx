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

  expect(await screen.findByText('Synthetic medication')).toBeTruthy();
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
