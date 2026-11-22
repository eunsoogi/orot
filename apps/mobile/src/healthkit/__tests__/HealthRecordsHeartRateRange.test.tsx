import { fireEvent, render, screen } from '@testing-library/react-native';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { HealthRecordsLineChart } from '../HealthRecordsLineChart';

// Preserve distinct recorded instants and the existing adjustable selected-value surface.
test('renders raw heart samples as instant ranges, without importing the derived concepts', async () => {
  const at = '2035-01-01T09:30:00Z';
  const raw = healthObservation('first', 'heart_rate', at);
  if (raw.value.kind !== 'quantity')
    throw new Error('Synthetic fixture needs BPM');
  await render(
    <HealthRecordsLineChart
      category="heart_rate"
      observations={[
        { ...raw, value: { ...raw.value, amount: 60 } },
        { ...raw, id: 'second', value: { ...raw.value, amount: 100 } },
        { ...raw, id: 'single', effectiveAt: '2035-01-02T09:00:00Z' },
        { ...raw, id: 'not-generic', concept: 'resting_heart_rate' },
      ]}
    />,
  );
  await fireEvent(
    screen.getByTestId('health-record-chart-plot-row'),
    'layout',
    {
      nativeEvent: { layout: { width: 320 } },
    },
  );
  const options = { includeHiddenElements: true };
  expect(screen.getAllByTestId('chart-range-span', options)).toHaveLength(1);
  expect(screen.getAllByTestId('chart-range-single', options)).toHaveLength(1);
  const selected = screen.getByTestId('health-record-chart-heart_rate');
  expect(selected.props.accessibilityLabel).toContain('측정값 72회/분');
  await fireEvent.press(
    screen.getByTestId('health-record-chart-heart_rate-previous'),
  );
  expect(selected.props.accessibilityLabel).toContain(
    '최저 60회/분, 최고 100회/분, 평균 80회/분',
  );
  expect(selected.props.accessibilityLabel).toContain('출처: 건강 앱');
});
