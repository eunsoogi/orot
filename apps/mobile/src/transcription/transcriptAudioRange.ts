/** Preserve Apple's fractional-second coverage without pretending to have word-level timestamps. */
export function transcriptAudioRange(
  startSeconds: number,
  endSeconds: number,
  durationMs: number,
) {
  const range = {
    startMs: Math.floor(startSeconds * 1000),
    endMs: Math.ceil(endSeconds * 1000),
  };
  if (
    range.startMs < 0 ||
    range.endMs <= range.startMs ||
    range.endMs > durationMs
  ) {
    throw new Error(
      'The native transcript range does not fit its saved recording.',
    );
  }
  return range;
}
