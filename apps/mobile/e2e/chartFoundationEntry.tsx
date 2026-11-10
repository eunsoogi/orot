import {
  AppRegistry,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
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

/** Synthetic local-only fixture for exercising the real native renderer. */
function ChartFoundationFixture() {
  const { width } = useWindowDimensions();
  const shared = {
    width: width - 32,
    height: 220,
    stateLabel: '일부 자료',
    largeTextLabel: '큰 글자에서는 아래 목록으로 값을 확인하세요.',
    formatPosition: (x: string) => x.slice(5, 16),
    formatValue: (x: number, unit: string) => `${x} ${unit}`,
  };
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.fill}>
        <ScrollView contentContainerStyle={styles.content}>
          <ChartPlot {...shared} kind="line" title="혈압" data={line} />
          <ChartPlot {...shared} kind="bar" title="걸음" data={bars} />
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: 16 },
});
AppRegistry.registerComponent(name, () => ChartFoundationFixture);
