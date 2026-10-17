import { fireEvent, render, screen } from '@testing-library/react-native';
import { mapBloodPressureCorrelation } from '../bloodPressure/mapper';
import { correlation } from '../bloodPressure/testSupport';
import { HealthRecordsDetailScreen } from '../HealthRecordsDetailScreen';

test('shows the selected period as paired source values with exact units', async () => {
  const observations = mapBloodPressureCorrelation(
    correlation('detail-pressure'),
    '2026-10-05T10:00:00.000Z',
  ).observations;
  const loadObservations = jest.fn(async () => ({
    records: observations,
    nextCursor: null,
  }));
  const onSelectionChange = jest.fn();

  await render(
    <HealthRecordsDetailScreen
      loadObservations={loadObservations}
      onBack={jest.fn()}
      onSelectionChange={onSelectionChange}
      selection={{ category: 'blood_pressure', period: 'month' }}
    />,
  );

  expect(await screen.findByTestId('health-record-row-0')).toBeTruthy();
  expect(
    screen.getByTestId('health-record-row-0-systolic').props.children,
  ).toBe('수축기 120 mmHg');
  expect(
    screen.getByTestId('health-record-row-0-diastolic').props.children,
  ).toBe('이완기 80 mmHg');
  expect(
    screen.getByTestId('health-record-period-month').props.accessibilityState,
  ).toMatchObject({ selected: true });

  await fireEvent.press(screen.getByTestId('health-record-period-all'));
  expect(onSelectionChange).toHaveBeenCalledWith({
    category: 'blood_pressure',
    period: 'all',
  });
});
