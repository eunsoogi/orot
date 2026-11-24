import type { ChartKind } from './types';

/** Workout duration, not workout heart rate, uses calendar bars on both surfaces. */
export function workoutRecordsChartKind(
  metric: string,
  otherwise: ChartKind,
): ChartKind {
  return metric === 'workouts' ? 'bar' : otherwise;
}
