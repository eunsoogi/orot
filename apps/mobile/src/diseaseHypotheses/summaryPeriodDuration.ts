/** Parse only numeric Korean duration forms, with token boundaries; a 90-minute source cannot match 190 minutes by substring. */
export function matchesPeriodSleepMean(
  text: string,
  expectedSeconds: readonly number[],
): boolean {
  const compact = text
    .normalize('NFKC')
    .replace(/\s/gu, '')
    .replace(/(?<=\d),(?=\d)/gu, '');
  const durations =
    /(?<![\d.시])(?:(\d+(?:\.\d+)?)시간(?:(\d+(?:\.\d+)?)분)?(?:(\d+(?:\.\d+)?)초)?|(\d+(?:\.\d+)?)분(?:(\d+(?:\.\d+)?)초)?|(\d+(?:\.\d+)?)초)/gu;
  for (const match of compact.matchAll(durations)) {
    const seconds =
      Number(match[1] ?? 0) * 3600 +
      Number(match[2] ?? match[4] ?? 0) * 60 +
      Number(match[3] ?? match[5] ?? match[6] ?? 0);
    // Whole-minute display rounding is allowed only for forms that actually omit seconds.
    const tolerance = match[3] || match[5] || match[6] ? 1 : 30.3;
    if (
      expectedSeconds.some(
        expected => Math.abs(expected - seconds) <= tolerance,
      )
    )
      return true;
  }
  return false;
}
