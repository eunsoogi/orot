// CI counts are checked against actual test registrations by detox-release-shard-summary-inventory.test.mjs.
export const releaseShardInventory = [
  { wrapper: 'release-e2e.test.js', suites: 1, tests: 7 },
  { wrapper: 'release-e2e-data.test.js', suites: 1, tests: 7 },
];

export function resolveSelectedReleaseShard({
  suiteName,
  releaseShardBlocks,
  releaseShardingRequired,
}) {
  const selected = process.env.OROT_DETOX_RELEASE_SHARD;
  if (!selected) return null;
  const expected = releaseShardInventory.find(({ wrapper }) => wrapper === selected);
  if (!expected || suiteName !== 'e2e-release') {
    throw new Error(
      suiteName + ': selected Release shard is missing, unknown, or used in another profile',
    );
  }
  if (releaseShardingRequired || releaseShardBlocks) {
    throw new Error('e2e-release: a selected Release shard cannot use multi-Simulator summaries');
  }
  // Keep one-runner outputs tied to the same explicit wrapper and case inventory.
  return {
    configuration: 'Release ' + selected,
    suites: expected.suites,
    tests: expected.tests,
    testMatch: '<rootDir>/e2e/' + selected,
  };
}

export function validateReleaseJestConfig({
  releaseSuiteFiles,
  releaseE2EShards,
  releaseConfig,
  selectedReleaseShard,
}) {
  const expectedReleaseSuiteFiles = [
    './storage.test.js',
    './smoke.test.js',
    './safe-area.test.js',
    './storage-migration.test.js',
    './appointments.test.js',
    './medicalAppointmentClassification.test.js',
    './medicalAppointmentNavigation.test.js',
    './agentMemory.test.js',
    './graph.test.js',
    './checkpoint.detox.e2e.js',
  ];
  const flattenedReleaseShards = Object.values(releaseE2EShards).flat();
  // Keep the default and both split wrappers exhaustive against the ordered scenario inventory.
  if (
    JSON.stringify(releaseSuiteFiles) !== JSON.stringify(expectedReleaseSuiteFiles) ||
    JSON.stringify(flattenedReleaseShards) !== JSON.stringify(expectedReleaseSuiteFiles)
  ) {
    throw new Error(
      'e2e: Release shard manifest does not include the complete ordered test inventory',
    );
  }
  const expectedReleaseWrapper =
    selectedReleaseShard?.testMatch ?? '<rootDir>/e2e/release-e2e.test.js';
  if (
    JSON.stringify(releaseConfig.testMatch) !== JSON.stringify([expectedReleaseWrapper]) ||
    releaseConfig.maxWorkers !== 1
  ) {
    throw new Error('e2e: Release Jest config must run the ordered inventory on one worker');
  }
}

export function readReleaseShardBlocks(log) {
  // Each marker binds one explicit wrapper to its own Jest counts before profile totals are published.
  const markers = [...log.matchAll(/^DETOX_RELEASE_SHARD_SUMMARY_(START|END) shard=([^\r\n]+)$/gm)];
  if (markers.length === 0) return null;
  if (markers.length !== releaseShardInventory.length * 2) {
    throw new Error(
      `e2e-release: expected ${releaseShardInventory.length} complete Release shard summaries, received ${markers.length} markers`,
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
