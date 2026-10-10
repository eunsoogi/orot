import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const scanLauncher = join(repositoryRoot, 'scripts/ci/start-detox-build-input-scan.sh');
const dependencySetup = join(repositoryRoot, 'scripts/ci/install-detox-profile-dependencies.sh');

async function waitForFile(path) {
  const deadline = Date.now() + 3000;
  while (!existsSync(path) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(existsSync(path), `Timed out waiting for ${path}`);
}

async function waitForNoFile(path) {
  const deadline = Date.now() + 3000;
  while (existsSync(path) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(existsSync(path), false, `Timed out waiting for ${path} to be removed`);
}

function launchScan(fakeNodeBody) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-detox-scan-launch-'));
  const bin = join(directory, 'bin');
  const environmentFile = join(directory, 'github-env');
  mkdirSync(bin);
  writeFileSync(join(bin, 'node'), `#!/usr/bin/env bash\n${fakeNodeBody}\n`, { mode: 0o755 });
  const result = spawnSync('bash', [scanLauncher], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_ENV: environmentFile,
      GITHUB_RUN_ATTEMPT: '1',
      GITHUB_RUN_ID: 'scan-test',
      PATH: [bin, process.env.PATH].join(delimiter),
      RUNNER_TEMP: directory,
    },
    timeout: 3000,
  });
  return { directory, environmentFile, result };
}

test('publishes the completed input list through RUNNER_TEMP and GITHUB_ENV', async () => {
  const fixture = launchScan(
    '[[ "$1" == "scripts/ci/detox-cache-fingerprint-cli.mjs" ]]\n[[ "$2" == "--changed-build-inputs" ]]\nprintf \'[]\\n\'',
  );
  try {
    assert.equal(fixture.result.status, 0, fixture.result.stderr);
    const scanPath = readFileSync(fixture.environmentFile, 'utf8')
      .trim()
      .replace('DETOX_CACHE_BUILD_INPUTS_SCAN_PATH=', '');
    await waitForFile(scanPath);
    assert.deepEqual(JSON.parse(readFileSync(scanPath, 'utf8')), []);
    assert.equal(existsSync(`${scanPath}.tmp`), false);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('a failed background scan leaves no result so cache preparation can use its synchronous fallback', async () => {
  const fixture = launchScan('touch "$RUNNER_TEMP/scan-done"\nexit 23');
  try {
    assert.equal(fixture.result.status, 0, fixture.result.stderr);
    const scanPath = readFileSync(fixture.environmentFile, 'utf8')
      .trim()
      .replace('DETOX_CACHE_BUILD_INPUTS_SCAN_PATH=', '');
    await waitForFile(join(fixture.directory, 'scan-done'));
    await waitForFile(`${scanPath}.stderr`);
    assert.equal(existsSync(scanPath), false);
    await waitForNoFile(`${scanPath}.tmp`);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('installs profile dependencies before launching the changed-input scan', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-detox-profile-install-'));
  const bin = join(directory, 'bin');
  const orderLog = join(directory, 'order.log');
  const environmentFile = join(directory, 'github-env');
  mkdirSync(bin);
  // Stubs isolate the command order while the real background launcher exercises its handoff.
  writeFileSync(
    join(bin, 'pnpm'),
    '#!/usr/bin/env bash\nprintf "install:%s\\n" "$*" >>"$ORDER_LOG"\n',
    { mode: 0o755 },
  );
  writeFileSync(
    join(bin, 'node'),
    '#!/usr/bin/env bash\nprintf "scan:%s %s\\n" "$1" "$2" >>"$ORDER_LOG"\nprintf \'[]\\n\'\n',
    { mode: 0o755 },
  );

  try {
    const result = spawnSync('bash', [dependencySetup, 'release'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_ENV: environmentFile,
        ORDER_LOG: orderLog,
        PATH: [bin, process.env.PATH].join(delimiter),
        RUNNER_TEMP: directory,
      },
      timeout: 3000,
    });
    assert.equal(result.status, 0, result.stderr);
    await waitForFile(orderLog);
    const scanPath = readFileSync(environmentFile, 'utf8')
      .trim()
      .replace('DETOX_CACHE_BUILD_INPUTS_SCAN_PATH=', '');
    await waitForFile(scanPath);
    assert.deepEqual(readFileSync(orderLog, 'utf8').trim().split('\n'), [
      'install:install --frozen-lockfile',
      'scan:scripts/ci/detox-cache-fingerprint-cli.mjs --changed-build-inputs',
    ]);
    assert.deepEqual(JSON.parse(readFileSync(scanPath, 'utf8')), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
