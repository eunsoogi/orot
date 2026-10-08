const releaseShardInventory = [
  { wrapper: 'release-e2e.test.js', suites: 1, tests: 5 },
  { wrapper: 'release-e2e-data.test.js', suites: 1, tests: 8 },
];

export function readReleaseShardBlocks(log) {
  // Each marker binds one explicit wrapper to its own Jest counts before profile totals are published.
  const markers = [...log.matchAll(/^DETOX_RELEASE_SHARD_SUMMARY_(START|END) shard=([^\r\n]+)$/gm)];
  if (markers.length === 0) return null;
  if (markers.length !== releaseShardInventory.length * 2) {
    throw new Error(
      `e2e-release: expected two complete Release shard summaries, received ${markers.length} markers`,
    );
  }

  return releaseShardInventory.map((expected, index) => {
    const start = markers[index * 2];
    const end = markers[index * 2 + 1];
    if (
      start[1] !== 'START' ||
      end[1] !== 'END' ||
      start[2] !== expected.wrapper ||
      end[2] !== expected.wrapper ||
      start.index >= end.index
    ) {
      throw new Error(
        `e2e-release: Release shard summary ${index + 1} is missing, repeated, or out of order`,
      );
    }

    const body = log.slice(start.index + start[0].length, end.index);
    const tests = [...body.matchAll(/^Tests:\s*([^\r\n]+)$/gm)];
    const suites = [...body.matchAll(/^Test Suites:\s*([^\r\n]+)$/gm)];
    if (tests.length !== 1 || suites.length !== 1) {
      throw new Error(
        `e2e-release: ${expected.wrapper} must contain exactly one Jest test and suite summary`,
      );
    }
    return {
      wrapper: expected.wrapper,
      expected: {
        configuration: `Release ${expected.wrapper}`,
        suites: expected.suites,
        tests: expected.tests,
      },
      start: start.index,
      end: end.index + end[0].length,
    };
  });
}
