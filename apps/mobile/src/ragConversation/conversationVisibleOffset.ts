/** Keep a followed message above floating controls, including compact keyboard layouts. */
export function conversationVisibleOffset(
  end: number,
  height: number,
  inset = 0,
) {
  return Math.max(0, end - Math.max(0, height - inset));
}

/** Streaming follows the readable last item, not the region behind the overlay. */
export function conversationIsNearLatest(
  compactEnd: number | null,
  height: number,
  inset: number,
  contentHeight: number,
  offset: number,
) {
  return compactEnd !== null
    ? Math.abs(conversationVisibleOffset(compactEnd, height, inset) - offset) <
        48
    : contentHeight - offset - height < 48;
}
