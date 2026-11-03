/** Convert Actions timestamps without treating missing values as zero. */
export const instant = (value) => {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const duration = (start, end) => {
  const from = instant(start);
  const to = instant(end);
  return from !== undefined && to !== undefined && to >= from ? to - from : undefined;
};

export const isMacJob = (job) =>
  (job.labels ?? []).some((label) => /^(macos(?:-|$)|mac-|xcode-|apple)/i.test(label));
