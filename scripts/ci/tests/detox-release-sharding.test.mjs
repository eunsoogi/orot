import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const requireFromRepository = createRequire(join(repositoryRoot, 'package.json'));
const releaseJestConfig = requireFromRepository('./apps/mobile/e2e/release-e2e.jest.config.js');
const releaseShards = requireFromRepository('./apps/mobile/e2e/release-e2e-shards.js');
const releaseSuiteFiles = requireFromRepository('./apps/mobile/e2e/release-e2e-suite-files.js');
const releaseConfigPath = join(repositoryRoot, 'apps/mobile/e2e/release-e2e.jest.config.js');

test('Release assigns each ordered scenario shard to an isolated Detox worker', () => {
  // Each wrapper owns one simulator so first-use, data, and fresh-install state stay separate.
  assert.deepEqual(releaseJestConfig.testMatch, [
    '<rootDir>/e2e/release-e2e.test.js',
    '<rootDir>/e2e/release-e2e-data.test.js',
    '<rootDir>/e2e/release-e2e-storage.test.js',
  ]);
  assert.equal(releaseJestConfig.maxWorkers, 3);
  const assignedSuites = Object.values(releaseShards).flat();
  assert.deepEqual(assignedSuites, releaseSuiteFiles);
  assert.equal(new Set(assignedSuites).size, releaseSuiteFiles.length);
});

test('Release shard mode selects one wrapper and one Jest worker per explicit Simulator', () => {
  for (const wrapper of Object.keys(releaseShards)) {
    const output = execFileSync(
      process.execPath,
      ['-e', `process.stdout.write(JSON.stringify(require(${JSON.stringify(releaseConfigPath)})))`],
      { encoding: 'utf8', env: { ...process.env, OROT_DETOX_RELEASE_SHARD: wrapper } },
    );
    const config = JSON.parse(output);
    assert.deepEqual(config.testMatch, [`<rootDir>/e2e/${wrapper}`]);
    assert.equal(config.maxWorkers, 1);
  }

  const invalid = spawnSync(
    process.execPath,
    ['-e', `require(${JSON.stringify(releaseConfigPath)})`],
    { encoding: 'utf8', env: { ...process.env, OROT_DETOX_RELEASE_SHARD: 'missing.test.js' } },
  );
  assert.notEqual(invalid.status, 0);
});

test('routes a Release profile with three explicit Simulators through the shard runner', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-release-shard-route-'));
  const bin = join(directory, 'bin');
  const callsPath = join(directory, 'calls.log');
  const dataId = '11111111-2222-4333-8444-555555555555';
  const storageId = '66666666-7777-4888-8999-AAAAAAAAAAAA';
  const baseId = 'A1B2C3D4-E5F6-47A8-9012-3456789ABCDE';
  const pnpm = join(bin, 'pnpm');
  const timer = join(bin, 'time');
  const shell = (path, body) => {
    mkdirSync(bin, { recursive: true });
    writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  };
  try {
    shell(
      pnpm,
      `printf '%s\\t%s\\n' "$OROT_DETOX_RELEASE_SHARD" "$OROT_DETOX_SIMULATOR_UDID" >>"$CALLS_PATH"\nprintf 'Test Suites: 1 passed, 1 total\\nTests: 1 passed, 1 total\\n'`,
    );
    shell(timer, '[ "$1" = "-l" ] && shift\nexec "$@"');
    const result = spawnSync('bash', ['scripts/ci/run-detox-e2e.sh', 'release'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      timeout: 10000,
      env: {
        ...process.env,
        PATH: [bin, process.env.PATH].join(':'),
        DETOX_ARTIFACTS_LOCATION: join(directory, 'detox'),
        OROT_DETOX_SIMULATOR_UDID: baseId,
        OROT_DETOX_RELEASE_DATA_SIMULATOR_UDID: dataId,
        OROT_DETOX_RELEASE_STORAGE_SIMULATOR_UDID: storageId,
        OROT_DETOX_TEST_TIME_COMMAND: timer,
        OROT_DETOX_TEST_LOG_LEVEL: 'info',
        CALLS_PATH: callsPath,
      },
    });

    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.deepEqual(
      readFileSync(callsPath, 'utf8').trim().split('\n').sort(),
      [
        `release-e2e.test.js\t${baseId}`,
        `release-e2e-data.test.js\t${dataId}`,
        `release-e2e-storage.test.js\t${storageId}`,
      ].sort(),
    );
    assert.match(result.stdout, /DETOX_PROFILE_END profile=release status=0/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
