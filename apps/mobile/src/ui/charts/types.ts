/** Feature owners supply provenance and coverage; charts never fetch health data. */
export type ChartMetric =
  'workouts' | 'sleep' | 'heartRate' | 'bodyMass' | 'steps' | 'bloodPressure';
export type ChartStatus =
  'ready' | 'loading' | 'permission' | 'empty' | 'error' | 'partial' | 'stale';
export type ChartCoverage = {
  requested: string;
  displayed: string;
  status: ChartStatus;
};
export type ChartPoint = {
  /** ISO instant for lines, or a local calendar-day identity for bars. */
  x: string;
  value: number | null;
  source: string;
  partial?: boolean;
};
export type ChartSeries = {
  id: string;
  label: string;
  unit: string;
  /** Stable across screens and independent of array order. */
  style: 'primary' | 'secondary';
  points: readonly ChartPoint[];
};
export type ChartData = {
  metric: ChartMetric;
  coverage: ChartCoverage;
  series: readonly ChartSeries[];
};
