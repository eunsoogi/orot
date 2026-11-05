export const homeMetricGridGap = 8;

const minimumMetricCardWidth = 160;
const minimumRecentChangeRowWidth = 280;

export type HomeRecentChangeLayout = 'row' | 'column';

export interface HomeMetricGridLayout {
  readonly columns: 1 | 2;
  readonly cardWidth: number | '100%';
}

/** Keeps seven day labels readable by adding a second card only when both scaled cards fit. */
export function resolveHomeMetricGridLayout(
  measuredWidth: number,
  metricCount: number,
  fontScale: number,
): HomeMetricGridLayout {
  if (measuredWidth <= 0) return { columns: 1, cardWidth: '100%' };

  const readableCardWidth = minimumMetricCardWidth * Math.max(1, fontScale);
  const columns: 1 | 2 =
    metricCount > 1 &&
    measuredWidth >= readableCardWidth * 2 + homeMetricGridGap
      ? 2
      : 1;

  return {
    columns,
    cardWidth: (measuredWidth - homeMetricGridGap * (columns - 1)) / columns,
  };
}

/** Keeps previous and recent values together until the measured width or text scale needs stacking. */
export function resolveHomeRecentChangeLayout(
  measuredWidth: number,
  fontScale: number,
): HomeRecentChangeLayout {
  if (measuredWidth <= 0) return 'row';

  return measuredWidth >= minimumRecentChangeRowWidth * Math.max(1, fontScale)
    ? 'row'
    : 'column';
}
