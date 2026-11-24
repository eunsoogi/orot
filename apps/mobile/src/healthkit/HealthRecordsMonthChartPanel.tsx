import type {
  HealthObservationMonthChart,
  HealthObservationMonthChartLoader,
  HealthObservationMonthWindow,
} from '@orot/storage';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { ChartPlot } from '../ui/charts';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../storage/localDataClearEvents';
import { healthRecordCategoryTitle } from './healthRecordsLibraryModel';
import { buildHealthRecordsMonthChart } from './healthRecordsMonthChart';

export type HealthRecordsMonthChartInput = {
  readonly load: HealthObservationMonthChartLoader;
  readonly window: HealthObservationMonthWindow;
};
type Category = Parameters<HealthObservationMonthChartLoader>[0];
type Result = {
  key: string;
  projection?: HealthObservationMonthChart;
  failed?: boolean;
};

export function HealthRecordsMonthChartPanel({
  category,
  load,
  window,
}: HealthRecordsMonthChartInput & { category: Category }) {
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [result, setResult] = useState<Result>();
  const { fromInclusive, toInclusive } = window;
  const key = JSON.stringify([category, fromInclusive, toInclusive]);
  useEffect(() => {
    let owner = 0;
    const reload = () => {
      const request = ++owner;
      load(category, { fromInclusive, toInclusive })
        .then(projection => {
          if (request === owner) setResult({ key, projection });
        })
        .catch(() => {
          if (request === owner) setResult({ key, failed: true });
        });
    };
    const invalidate = () => {
      setResult(undefined);
      reload();
    };
    reload();
    const stopClear = subscribeLocalDataClear(invalidate);
    const stopDeletion = subscribeLocalSourceDeletion(invalidate);
    return () => {
      owner += 1;
      stopClear();
      stopDeletion();
    };
  }, [category, load, key, fromInclusive, toInclusive]);
  const active = result?.key === key ? result : undefined;
  const { data, kind } = buildHealthRecordsMonthChart(
    category,
    window,
    active?.projection,
    active?.failed,
  );
  return (
    <View
      onLayout={event => setMeasuredWidth(event.nativeEvent.layout.width)}
      testID="health-record-month-chart"
    >
      <ChartPlot
        data={data}
        compact
        width={measuredWidth}
        height={200}
        hideDetails={kind !== 'line'}
        barTooltip={kind !== 'line'}
        kind={kind}
        rangeAxis="day"
        title={healthRecordCategoryTitle(category)}
        testID={'health-record-chart-values-' + category}
        selectedPointTestID={'health-record-chart-' + category}
      />
    </View>
  );
}
