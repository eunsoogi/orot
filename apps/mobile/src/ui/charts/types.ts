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
export type ChartRange = {
  readonly minimum: number;
  readonly maximum: number;
  readonly samples: number;
};
export type ChartKind = 'line' | 'bar' | 'range';
export type ChartAxis = 'time' | 'day';
export type ChartPoint = {
  /** ISO instant for lines, or a local calendar-day identity for bars. */
  x: string;
  value: number | null;
  source: string;
  /** If present, value is the mean of these same sampled extrema. */
  range?: ChartRange;
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
export type ChartPresentation = 'whole-bpm-overview';
export type ChartData = {
  metric: ChartMetric;
  presentation?: ChartPresentation;
  coverage: ChartCoverage;
  series: readonly ChartSeries[];
};
