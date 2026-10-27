import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import type { HealthObservation } from '@orot/domain';
import { mapBloodPressureCorrelation } from '../bloodPressure/mapper';
import { correlation } from '../bloodPressure/testSupport';
import { HealthRecordsDetailRecordRow } from '../HealthRecordsDetailRecordRow';
import { buildHealthRecordsDetailRows } from '../healthRecordsDetailModel';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';

const measuredAt = '2026-10-05T10:00:00.000Z';

test('stacks pressure values when the measured record panel is narrow', async () => {
  const original = Dimensions.get('window');
  Dimensions.set({ window: { ...original, width: 900, fontScale: 1 } });

  try {
    await render(
      <HealthRecordsDetailRecordRow
        index={0}
        row={bloodPressureRow('narrow-detail-panel')}
      />,
    );
    await fireEvent(screen.getByTestId('health-record-row-0'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 160 } },
    });

    expect(screen.getByTestId('health-record-row-0-columns')).toHaveStyle({
      flexDirection: 'column',
      alignItems: 'stretch',
    });
  } finally {
    await act(() => Dimensions.set({ window: original }));
  }
});

test('shows saved source values and HealthKit provenance without source identifiers', async () => {
  const observations = mapBloodPressureCorrelation(
    correlation('detail-source-values'),
    measuredAt,
  ).observations.map(observation => {
    if (observation.value.kind !== 'quantity') return observation;
    return {
      ...observation,
      provenance: {
        ...observation.provenance,
        source: {
          system: 'healthkit',
          sourceName: 'Synthetic home monitor',
        },
      },
      value: {
        ...observation.value,
        sourceRepresentation: {
          status: 'available' as const,
          amount: observation.concept.endsWith('systolic') ? 16 : 10.7,
          unit: 'kPa',
        },
      },
    };
  });

  await render(
    <HealthRecordsDetailRecordRow
      index={0}
      row={bloodPressureRow('detail-source-values', observations)}
    />,
  );

  expect(
    screen.getByTestId('health-record-row-0-systolic').props.accessibilityLabel,
  ).toBe('수축기 16 kPa');
  expect(
    screen.getByTestId('health-record-row-0-systolic-source'),
  ).toHaveTextContent('HealthKit · Synthetic home monitor');
  expect(screen.queryByText('com.example.device')).toBeNull();
  expect(
    screen.queryByTestId('health-record-row-0-systolic-source-value'),
  ).toBeNull();
});

test('states when the saved record has no source or original value metadata', async () => {
  const observations = mapBloodPressureCorrelation(
    correlation('missing-detail-source'),
    measuredAt,
  ).observations.map(observation => ({
    ...observation,
    provenance: {
      origin: observation.provenance.origin,
      sourceRecordIds: observation.provenance.sourceRecordIds,
    },
  }));

  await render(
    <HealthRecordsDetailRecordRow
      index={0}
      row={bloodPressureRow('missing-detail-source', observations)}
    />,
  );

  expect(
    screen.getByTestId('health-record-row-0-systolic-source'),
  ).toHaveTextContent('출처 정보가 없어요.');
  expect(
    screen.getByTestId('health-record-row-0-systolic-source-value'),
  ).toHaveTextContent('출처에서 기록한 원래 값과 단위를 확인할 수 없어요.');
  expect(
    screen.getByTestId('health-record-row-0-systolic').props.accessibilityLabel,
  ).toBe('수축기 120 mmHg');
});

test('uses an available original quantity for a non-pressure observation', async () => {
  const source = healthObservation(
    'detail-heart-rate',
    'heart_rate',
    measuredAt,
  );
  if (source.value.kind !== 'quantity') {
    throw new Error('Expected the synthetic quantity observation.');
  }
  const observation: HealthObservation = {
    ...source,
    provenance: {
      ...source.provenance,
      source: { system: 'healthkit', sourceName: 'Synthetic watch' },
    },
    value: {
      ...source.value,
      sourceRepresentation: { status: 'available', amount: 72, unit: 'bpm' },
    },
  };
  const row = buildHealthRecordsDetailRows(
    'heart_rate',
    [observation],
    'all',
    measuredAt,
  )[0];
  if (!row) throw new Error('Expected the synthetic heart-rate row.');

  await render(<HealthRecordsDetailRecordRow index={0} row={row} />);

  expect(screen.getByTestId('health-record-row-0-value')).toHaveTextContent(
    '72 bpm',
  );
  expect(screen.getByTestId('health-record-row-0-source')).toHaveTextContent(
    'HealthKit · Synthetic watch',
  );
});

function bloodPressureRow(
  id: string,
  observations = mapBloodPressureCorrelation(correlation(id), measuredAt)
    .observations,
) {
  const row = buildHealthRecordsDetailRows(
    'blood_pressure',
    observations,
    'all',
    measuredAt,
  )[0];
  if (!row) throw new Error('Expected the synthetic pressure row.');
  return row;
}
