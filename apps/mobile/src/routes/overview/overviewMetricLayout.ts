export const overviewMetricGridGap = 8;

// Keep the existing 320pt readable-column floor instead of treating a compact chart as a full card.
// The measured grid already excludes the shell's reserved rail and Home's content gutters.
const minimumMetricCardWidth = 320;
const minimumRecentChangeRowWidth = 280;

export type OverviewRecentChangeLayout = 'row' | 'header' | 'column';

export interface OverviewMetricGridLayout {
  readonly columns: 1 | 2;
  readonly cardWidth: number | '100%';
}

/** Adds a second full metric card only when both readable, text-scaled columns fit. */
export function resolveOverviewMetricGridLayout(
  measuredWidth: number,
  metricCount: number,
  fontScale: number,
): OverviewMetricGridLayout {
  if (measuredWidth <= 0) return { columns: 1, cardWidth: '100%' };

  const readableCardWidth = minimumMetricCardWidth * Math.max(1, fontScale);
  const columns: 1 | 2 =
    metricCount > 1 &&
    measuredWidth >= readableCardWidth * 2 + overviewMetricGridGap
      ? 2
      : 1;

  return {
    columns,
    cardWidth:
      (measuredWidth - overviewMetricGridGap * (columns - 1)) / columns,
  };
}

/** Keeps previous and recent values together until the measured width or text scale needs stacking. */
export function resolveOverviewRecentChangeLayout(
  measuredWidth: number,
  fontScale: number,
): OverviewRecentChangeLayout {
  if (measuredWidth <= 0) return 'row';

  if (fontScale > 1.15 || measuredWidth < minimumRecentChangeRowWidth)
    return 'column';
  // Reserve a full heading when the identity and both values cannot share a row.
  return measuredWidth >= 430 ? 'row' : 'header';
}
