type Fact = Record<string, unknown>;
const compact = (text: string) =>
  text
    .normalize('NFKC')
    .replace(/\s/gu, '')
    .replace(/(?<=\d),(?=\d)/gu, '');

/** Check recognized stage-local duration expressions against individual cited intervals, allowing whole-second rounding.
 * This is a bounded comparison, not a parser for every possible duration paraphrase or a nightly-total calculation.
 */
export function summarySleepDurationMismatch(
  summary: string,
  facts: readonly Fact[],
): boolean {
  const expected = new Map<string, number[]>();
  for (const fact of facts) {
    const semantics = fact.sourceSemantics;
    if (!semantics || typeof semantics !== 'object' || Array.isArray(semantics))
      continue;
    const value = semantics as Fact;
    if (
      value.intervalScope !== 'single_sample_not_nightly_total' ||
      typeof value.sleepStage !== 'string' ||
      typeof value.intervalDurationSeconds !== 'number' ||
      !Number.isFinite(value.intervalDurationSeconds) ||
      value.intervalDurationSeconds <= 0
    )
      continue;
    const stage = compact(value.sleepStage);
    expected.set(stage, [
      ...(expected.get(stage) ?? []),
      value.intervalDurationSeconds,
    ]);
  }
  const text = compact(summary);
  const positions: { stage: string; index: number }[] = [];
  for (const stage of expected.keys()) {
    let offset = 0;
    while (stage && offset < text.length) {
      const index = text.indexOf(stage, offset);
      if (index < 0) break;
      positions.push({ stage, index });
      offset = index + stage.length;
    }
  }
  positions.sort((a, b) => a.index - b.index);
  return positions.some(({ stage, index }, position) => {
    const end = Math.min(
      index + stage.length + 200,
      positions[position + 1]?.index ?? text.length,
    );
    // A clock's minute/second suffix must not be reinterpreted as elapsed time.
    const match =
      /(?<![시분\d.])(?:(\d+)시간)?(?:(\d+)분)?(\d+(?:\.\d+)?)초/u.exec(
        text.slice(index + stage.length, end),
      );
    if (!match) return false;
    const claimed =
      Number(match[1] ?? 0) * 3600 +
      Number(match[2] ?? 0) * 60 +
      Number(match[3]);
    return !expected
      .get(stage)!
      .some(seconds => Math.abs(seconds - claimed) <= 1);
  });
}
