export const MANUAL_HISTORY_LIST_MINIMUM_WIDTH = 280;
export const MANUAL_HISTORY_DETAILS_MINIMUM_WIDTH = 320;
export const MANUAL_HISTORY_PANEL_GAP = 12;

/** Keeps both panels readable by scaling their measured-width requirement with Dynamic Type. */
export function manualHistorySupportsColumns(
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

  const scale = Math.max(1, fontScale);
  return (
    availableWidth >=
    (MANUAL_HISTORY_LIST_MINIMUM_WIDTH +
      MANUAL_HISTORY_DETAILS_MINIMUM_WIDTH +
      MANUAL_HISTORY_PANEL_GAP) *
      scale
  );
}
