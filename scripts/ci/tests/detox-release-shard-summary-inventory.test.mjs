import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const releaseRoot = join(repositoryRoot, 'apps/mobile/e2e');
const requireFromRepository = createRequire(join(repositoryRoot, 'package.json'));
const releaseShards = requireFromRepository('./apps/mobile/e2e/release-e2e-shards.js');
const summaryGuard = fileURLToPath(new URL('../require-jest-summary.mjs', import.meta.url));

function countRegisteredTests(files) {
  let count = 0;
  for (const file of files) {
    const testPath = join(releaseRoot, file);
    runInNewContext(
      readFileSync(testPath, 'utf8'),
      {
        afterAll() {},
        afterEach() {},
        beforeAll() {},
        beforeEach() {},
        describe(_name, register) {
          register();
        },
        it() {
          count += 1;
        },
        process: { env: {} },
        require() {
          return {};
        },
        test() {
          count += 1;
        },
      },
      { filename: testPath },
    );
  }
  return count;
}

function runReleaseSummary(counts) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-release-summary-inventory-'));
  const logPath = join(directory, 'jest.log');
  const log = counts
    .map(([wrapper, count]) =>
      [
        `DETOX_RELEASE_SHARD_SUMMARY_START shard=${wrapper}`,
        'Test Suites: 1 passed, 1 total',
        `Tests: ${count} passed, ${count} total`,
        `DETOX_RELEASE_SHARD_SUMMARY_END shard=${wrapper}`,
      ].join('\n'),
    )
    .join('\n');
  try {
    writeFileSync(logPath, `${log}\n`);
    return spawnSync(process.execPath, [summaryGuard, logPath, 'e2e-release'], {
      encoding: 'utf8',
      env: { ...process.env, OROT_DETOX_RELEASE_SHARDING: 'true' },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('Release shard summaries follow the registered cases and reject stale partitions', () => {
  const actual = Object.entries(releaseShards).map(([wrapper, files]) => [
    wrapper,
    countRegisteredTests(files),
  ]);
  assert.deepEqual(actual, [
    ['release-e2e.test.js', 3],
    ['release-e2e-data.test.js', 10],
  ]);

  // Count real test registrations so moving a scenario cannot silently stale the log validator.
  const current = runReleaseSummary(actual);
  assert.equal(current.status, 0, current.stderr);

  const stale = runReleaseSummary([
    ['release-e2e.test.js', 2],
    ['release-e2e-data.test.js', 11],
  ]);
  assert.notEqual(stale.status, 0);
});
