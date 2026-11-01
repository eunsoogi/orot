/** Reserves one scaled reading line before allowing the editor to grow. */
export function conversationComposerLayout(
  height: number,
  bottomOcclusion: number,
  fontScale: number,
) {
  const scale = Math.max(1, fontScale);
  const minimumInputHeight = Math.max(44, Math.ceil(22 * scale + 22));
  const readingHeight = Math.ceil(24 * scale);
  const disclaimerHeight = Math.ceil(18 * scale);
  const normalChrome = 16 + 4 + disclaimerHeight + 16;
  const compact =
    height > 0 &&
    height - bottomOcclusion - normalChrome - minimumInputHeight <
      readingHeight;
  // In a short keyboard viewport the disclaimer moves into history and the
  // dock gives up optional spacing, while navigation keeps its measured clearance.
  const chrome = compact ? 0 : normalChrome;
  const budget =
    height > 0 ? height - bottomOcclusion - chrome - readingHeight : Infinity;
  return {
    compact,
    maximumInputHeight: Math.max(
      minimumInputHeight,
      Math.min(160 * scale, budget),
    ),
  };
}
