import { fireEvent, render } from '@testing-library/react-native';
import type { HealthObservationPageLoader } from '@orot/storage';
import { HealthRecordsLibraryScreen } from '../HealthRecordsLibraryScreen';

jest.mock('../../ui/charts', () => ({
  ChartPlot: ({
    data,
  }: {
    data: { series: { points: { x: string; value: number }[] }[] };
  }) => {
    const { Text } = require('react-native');
    return (
      <Text>
        {data.series
          .flatMap(s => s.points)
          .map(p => p.value)
          .join(',')}
      </Text>
    );
  },
}));

test('records chart uses actual month projection while opening the ordinary indexed detail route', async () => {
  const readMonthChart = jest.fn(async () => ({
    kind: 'quantity' as const,
    rows: [
      {
        effectiveAt: '2026-11-01T00:00:00Z',
        concept: 'blood pressure systolic',
        unit: 'mmHg',
        source: '[]',
        sampleCount: 2,
        min: 105,
        max: 125,
        mean: 115,
        sum: 230,
      },
    ],
  }));
  const load: HealthObservationPageLoader = Object.assign(
    jest.fn(async () => ({
      records: [],
      nextCursor: {
        effectiveAt: '2026-11-22T06:30:00Z',
        id: 'dense-newest-cutoff',
      },
    })),
    { readMonthChart },
  );
  const onOpenDetail = jest.fn();
  const view = await render(
    <HealthRecordsLibraryScreen
      onBack={() => {}}
      onOpenHealthImport={() => {}}
      onOpenDetail={onOpenDetail}
      loadObservations={load}
      loadMedicationData={async () => ({ definitions: [], doseEvents: [] })}
    />,
  );
  expect(await view.findByText('115')).toBeVisible();
  expect(readMonthChart).toHaveBeenCalledTimes(1);
  const [category, window] = readMonthChart.mock.calls[0] as unknown as [
    string,
    { fromInclusive: string; toInclusive: string },
  ];
  expect(category).toBe('blood_pressure');
  expect(load).toHaveBeenCalledWith(null, { category, ...window });
  await fireEvent.press(
    view.getByTestId('health-record-open-detail-blood_pressure'),
  );
  expect(onOpenDetail).toHaveBeenCalledWith({
    category: 'blood_pressure',
    period: 'month',
  });
});
