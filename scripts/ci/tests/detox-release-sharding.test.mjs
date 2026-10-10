import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const requireFromRepository = createRequire(join(repositoryRoot, 'package.json'));
const releaseJestConfig = requireFromRepository('./apps/mobile/e2e/release-e2e.jest.config.js');
const releaseShards = requireFromRepository('./apps/mobile/e2e/release-e2e-shards.js');
const releaseSuiteFiles = requireFromRepository('./apps/mobile/e2e/release-e2e-suite-files.js');
const releaseConfigPath = join(repositoryRoot, 'apps/mobile/e2e/release-e2e.jest.config.js');

test('Release runs the full ordered inventory in one default worker', () => {
  assert.deepEqual(releaseJestConfig.testMatch, ['<rootDir>/e2e/release-e2e.test.js']);
  assert.equal(releaseJestConfig.maxWorkers, 1);
  const assignedSuites = Object.values(releaseShards).flat();
  assert.deepEqual(assignedSuites, releaseSuiteFiles);
  assert.equal(new Set(assignedSuites).size, releaseSuiteFiles.length);
});

test('the ordered Release wrapper loads every scenario once while explicit shards retain their partition', () => {
  const wrapper = readFileSync(join(repositoryRoot, 'apps/mobile/e2e/release-e2e.test.js'), 'utf8');
  const loadSuites = (selectedShard) => {
    const loaded = [];
    runInNewContext(wrapper, {
      beforeAll: () => {},
      device: {},
      describe: (_name, callback) => callback(),
      process: {
        env: selectedShard ? { OROT_DETOX_RELEASE_SHARD: selectedShard } : {},
      },
      require: (path) => {
        if (path === './release-e2e-shards.js') return releaseShards;
        if (path === './release-e2e-suite-files.js') return releaseSuiteFiles;
        // The shared reset guard configures phases but does not add an E2E scenario.
        if (path === './storageProbeResetGuard.e2e.js') return {};
        loaded.push(path);
        return {};
      },
    });
    return loaded;
  };

  assert.deepEqual(loadSuites(), releaseSuiteFiles);
  assert.deepEqual(
    loadSuites('release-e2e-data.test.js'),
    releaseShards['release-e2e-data.test.js'],
  );
  assert.deepEqual(
    loadSuites('release-e2e-safe-area.test.js'),
    releaseShards['release-e2e-safe-area.test.js'],
  );
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

test('routes a Release profile through three explicit Simulators', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-release-shard-route-'));
  const bin = join(directory, 'bin');
  const callsPath = join(directory, 'calls.log');
  const safeAreaId = '22222222-3333-4444-8555-666666666666';
  const dataId = '11111111-2222-4333-8444-555555555555';
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
        // The fixture runs on hosted Linux; select its portable timer instead of Darwin's production timer.
        GITHUB_ACTIONS: 'false',
        PATH: [bin, process.env.PATH].join(':'),
        DETOX_ARTIFACTS_LOCATION: join(directory, 'detox'),
        OROT_DETOX_SIMULATOR_UDID: baseId,
        OROT_DETOX_RELEASE_SHARDING: 'true',
        OROT_DETOX_RELEASE_SAFE_AREA_SIMULATOR_UDID: safeAreaId,
        OROT_DETOX_RELEASE_DATA_SIMULATOR_UDID: dataId,
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
        `release-e2e-safe-area.test.js\t${safeAreaId}`,
        `release-e2e-data.test.js\t${dataId}`,
      ].sort(),
    );
    assert.match(result.stdout, /DETOX_PROFILE_END profile=release status=0/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
