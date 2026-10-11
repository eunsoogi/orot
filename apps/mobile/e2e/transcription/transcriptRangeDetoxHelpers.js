const { expect: jestExpect } = require('@jest/globals');

/** Converts the rendered MM:SS.mmm en-dash range into playback millisecond offsets. */
function transcriptRangeMilliseconds(rangeLabel) {
  jestExpect(typeof rangeLabel).toBe('string');
  const range = /^(\d{2}):(\d{2})\.(\d{3})–(\d{2}):(\d{2})\.(\d{3})$/.exec(
    rangeLabel,
  );
  jestExpect(range).not.toBeNull();
  const toMilliseconds = (minutes, seconds, milliseconds) =>
    Number(minutes) * 60_000 + Number(seconds) * 1000 + Number(milliseconds);
  return {
    startMs: toMilliseconds(range[1], range[2], range[3]),
    endMs: toMilliseconds(range[4], range[5], range[6]),
  };
}

module.exports = { transcriptRangeMilliseconds };
