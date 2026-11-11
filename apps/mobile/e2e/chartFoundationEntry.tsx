import { useState } from 'react';
import {
  AppRegistry,
  Button,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { name } from '../app.json';
import { ChartPlot } from '../src/ui/charts/ChartPlot';
import type { ChartData } from '../src/ui/charts/types';

const coverage = {
  requested: '7일',
  displayed: '3일',
  status: 'partial',
} as const;
const line: ChartData = {
  metric: 'bloodPressure',
  coverage,
  series: [
    {
      id: 'systolic',
      style: 'primary',
      label: '수축기',
      unit: 'mmHg',
      points: [
        { x: '2026-01-01T00:00:00Z', value: 120, source: 'synthetic' },
        { x: '2026-01-01T02:00:00Z', value: 82, source: 'synthetic' },
        { x: '2026-01-01T04:00:00Z', value: 130, source: 'synthetic' },
      ],
    },
    {
      id: 'diastolic',
      style: 'secondary',
      label: '이완기',
      unit: 'mmHg',
      points: [
        { x: '2026-01-01T00:00:00Z', value: 80, source: 'synthetic' },
        { x: '2026-01-01T01:00:00Z', value: null, source: 'synthetic' },
        { x: '2026-01-01T04:00:00Z', value: 85, source: 'synthetic' },
      ],
    },
  ],
};
const bars: ChartData = {
  metric: 'steps',
  coverage,
  series: [
    {
      id: 'steps',
      style: 'primary',
      label: '걸음',
      unit: '걸음',
      points: [
        { x: '2026-01-01', value: 0, source: 'synthetic' },
        { x: '2026-01-02', value: null, source: 'synthetic' },
        { x: '2026-01-03', value: 1234, source: 'synthetic', partial: true },
      ],
    },
  ],
};
const dense: ChartData = {
  metric: 'heartRate',
  coverage: {
    requested: '201회 측정',
    displayed: '201회 측정',
    status: 'ready',
  },
  series: [
    {
      id: 'heartRate',
      style: 'primary',
      label: '심박수',
      unit: 'count/min',
      points: Array.from({ length: 201 }, (_, index) => ({
        x: new Date(Date.UTC(2026, 0, 1, 0, index * 17)).toISOString(),
        value: index === 200 ? 199 : 60 + (index % 30),
        source: '합성 자료',
      })),
    },
  ],
};

/** Synthetic local-only fixture for exercising the real native renderer. */
function ChartFoundationFixture() {
  return (
    <SafeAreaProvider>
      <ChartFoundationContent />
    </SafeAreaProvider>
  );
}

function ChartFoundationContent() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [showDense, setShowDense] = useState(true);
  // The renderer needs the content width, excluding landscape safe areas and padding.
  const shared = {
    width: width - insets.left - insets.right - 32,
    height: 220,
  };
  return (
    <SafeAreaView style={styles.fill}>
      <ScrollView contentContainerStyle={styles.content}>
        <ChartPlot
          {...shared}
          kind="line"
          title="혈압"
          data={line}
          testID="synthetic-pressure-chart"
        />
        <ChartPlot {...shared} kind="bar" title="걸음" data={bars} />
        <Button
          title={showDense ? '밀집 자료 닫기' : '밀집 자료 열기'}
          onPress={() => setShowDense(!showDense)}
        />
        {showDense && (
          <ChartPlot
            {...shared}
            kind="line"
            title="밀집 심박수"
            data={dense}
            testID="dense-health-chart"
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: 16 },
});
AppRegistry.registerComponent(name, () => ChartFoundationFixture);
