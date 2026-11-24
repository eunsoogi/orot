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

test('combines distinct local-hour readings into a genuine daily preview range', async () => {
  const raw = healthObservation(
    'morning',
    'heart_rate',
    new Date(2035, 0, 1, 9, 30).toISOString(),
  );
  if (raw.value.kind !== 'quantity')
    throw new Error('Synthetic fixture needs BPM');
  await render(
    <HealthRecordsLineChart
      category="heart_rate"
      preview
      observations={[
        { ...raw, value: { ...raw.value, amount: 60 } },
        {
          ...raw,
          id: 'afternoon',
          effectiveAt: new Date(2035, 0, 1, 16).toISOString(),
          value: { ...raw.value, amount: 100 },
        },
        {
          ...raw,
          id: 'next-day',
          effectiveAt: new Date(2035, 0, 2, 9).toISOString(),
        },
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
});

test('keeps preview line measurements opt-in and adjustable', async () => {
  await render(
    <HealthRecordsLineChart
      category="steps"
      preview
      observations={[
        healthObservation('steps-one', 'step_count', '2035-01-01T09:00:00Z'),
        healthObservation('steps-two', 'step_count', '2035-01-02T09:00:00Z'),
      ]}
    />,
  );
  expect(screen.queryByText(/그래프는 저장된 측정값/)).toBeNull();
  const selectedId = 'health-record-chart-steps';
  expect(screen.queryByTestId(selectedId)).toBeNull();
  await fireEvent.press(
    screen.getByTestId('health-record-chart-values-steps-details'),
  );
  expect(screen.getByTestId(selectedId).props.accessibilityRole).toBe(
    'adjustable',
  );
});

test('keeps different sensors independently selectable at the same day', async () => {
  const day = (hour: number) => new Date(2035, 0, 1, hour).toISOString();
  const a = healthObservation('watch-one', 'heart_rate', day(8));
  if (a.value.kind !== 'quantity' || !a.provenance.source)
    throw new Error('Synthetic fixture needs a source and BPM');
  const sample = (
    name: string,
    item: string,
    hour: number,
    amount: number,
  ) => ({
    ...a,
    id: item,
    effectiveAt: day(hour),
    provenance: {
      ...a.provenance,
      source: {
        ...a.provenance.source!,
        sourceName: name,
        sourceIdentifier: name,
      },
    },
    value: { ...a.value, kind: 'quantity' as const, amount, unit: 'count/min' },
  });
  await render(
    <HealthRecordsLineChart
      category="heart_rate"
      preview
      observations={[
        sample('watch', 'watch-one', 8, 60),
        sample('watch', 'watch-two', 10, 80),
        sample('phone', 'phone-one', 12, 90),
        sample('phone', 'phone-two', 13, 100),
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
  const spans = screen.getAllByTestId('chart-range-span', {
    includeHiddenElements: true,
  });
  expect(spans).toHaveLength(2);
  expect(spans[0]?.props.x1).not.toBe(spans[1]?.props.x1);
  const plot = screen.getByTestId('health-record-chart-values-heart_rate-plot');
  await fireEvent(plot, 'accessibilityAction', {
    nativeEvent: { actionName: 'increment' },
  });
  expect(plot.props.accessibilityLabel).toContain('phone');
  expect(plot.props.accessibilityLabel).toContain('평균 95회/분');
  await fireEvent(plot, 'accessibilityAction', {
    nativeEvent: { actionName: 'increment' },
  });
  expect(plot.props.accessibilityLabel).toContain('watch');
  expect(plot.props.accessibilityLabel).toContain('평균 70회/분');
});
