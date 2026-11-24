import { isDailyReportActivityMarker } from './dailyReportEmptyActivity';
import { StyleSheet, View } from 'react-native';
import type { DailyReportSourceCoverage } from '@orot/domain';
import {
  DailyReportCoverageCard,
  DailyReportCoverageEmptyCard,
} from './DailyReportCoverageCard';

/** Presents verified report inputs as cards without implying provider success. */
export function DailyReportCoverage({
  coverage,
  sourceCounts,
  timeZone,
}: {
  readonly coverage: readonly DailyReportSourceCoverage[];
  readonly sourceCounts?: ReadonlyMap<string, number>;
  readonly timeZone: string;
}) {
  // The checked-empty activity findings already lead their report observations.
  const sources = coverage.filter(item => !isDailyReportActivityMarker(item));
  return (
    <View style={styles.grid} testID="daily-report-coverage-grid">
      {sources.length ? (
        sources.map((item, index) => (
          <DailyReportCoverageCard
            key={`${item.source}:${index}`}
            item={item}
            sourceCounts={sourceCounts}
            timeZone={timeZone}
          />
        ))
      ) : (
        <DailyReportCoverageEmptyCard />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'stretch',
    gap: 12,
  },
});
