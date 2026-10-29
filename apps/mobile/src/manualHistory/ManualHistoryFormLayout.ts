export const MANUAL_HISTORY_INLINE_DATE_MINIMUM_WIDTH = 760;

/** Keeps the date editor and date-knowledge choice readable in one measured lane. */
export function manualHistorySupportsInlineDateControls(
  availableWidth: number,
  fontScale: number,
): boolean {
  if (
    !Number.isFinite(availableWidth) ||
    availableWidth <= 0 ||
    !Number.isFinite(fontScale) ||
    fontScale <= 0
  ) {
    return false;
  }

  return (
    availableWidth >=
    MANUAL_HISTORY_INLINE_DATE_MINIMUM_WIDTH * Math.max(1, fontScale)
  );
}
