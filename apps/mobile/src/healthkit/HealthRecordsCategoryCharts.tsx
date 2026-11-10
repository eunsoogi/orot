import { StyleSheet, View } from 'react-native';
import type { HealthObservation } from '@orot/domain';
import type { HealthObservationCategory } from './healthRecordsLibraryModel';
import { HealthRecordsLineChart } from './HealthRecordsLineChart';

/** Different stored units get independent axes; no conversion or cross-unit line is invented. */
export function HealthRecordsCategoryCharts({
  category,
  observations,
  hasMore,
  loadState,
}: {
  readonly category: HealthObservationCategory;
  readonly observations: readonly HealthObservation[];
  readonly hasMore: boolean;
  readonly loadState: 'loading' | 'ready' | 'failed';
}) {
  const units = new Map<string, HealthObservation[]>();
  for (const observation of observations) {
    if (observation.value.kind !== 'quantity') continue;
    const unit = observation.value.unit;
    const records = units.get(unit) ?? [];
    records.push(observation);
    units.set(unit, records);
  }
  return (
    <View style={styles.charts}>
      {(units.size
        ? [...units]
        : [['', []] as [string, HealthObservation[]]]
      ).map(([unit, records]) => (
        <HealthRecordsLineChart
          key={unit}
          category={category}
          observations={records}
          hasMore={hasMore}
          loadState={loadState}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({ charts: { gap: 16 } });
