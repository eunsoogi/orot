import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const teardownScript = join(repositoryRoot, 'scripts/ci/teardown-detox-simulator.sh');
const base = 'A1B2C3D4-E5F6-47A8-9012-3456789ABCDE';
const workerOne = '11111111-2222-4333-8444-555555555555';
const unrelated = 'BBBBBBBB-CCCC-4DDD-8EEE-FFFFFFFFFFFF';

function fixture(implementation) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-detox-profile-teardown-'));
  const artifacts = join(directory, 'artifacts');
  const bin = join(directory, 'bin');
  const deleted = join(directory, 'deleted');
  mkdirSync(artifacts, { recursive: true });
  mkdirSync(bin, { recursive: true });
  mkdirSync(deleted, { recursive: true });
  const callsPath = join(directory, 'xcrun-calls.log');
  writeFileSync(
    join(bin, 'xcrun'),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >>"$XCRUN_CALLS"\n${implementation}\n`,
    { mode: 0o755 },
  );
  return { directory, artifacts, bin, callsPath, deleted };
}

function runTeardown(context, args) {
  return spawnSync('bash', [teardownScript, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: [context.bin, process.env.PATH].join(':'),
      XCRUN_CALLS: context.callsPath,
      DELETED: context.deleted,
    },
  });
}

test('cleans recorded Release workers when diagnostics omitted their IDs', () => {
  const context = fixture(
    [
      'if [[ "$*" == "simctl list devices" || "$*" == "simctl list devices booted" ]]; then',
      `  for id in ${base} ${workerOne}; do [[ -f "$DELETED/$id" ]] || printf '%s (Booted)\\n' "$id"; done`,
      `  printf '%s (Shutdown)\\n' '${unrelated}'`,
      'elif [[ "$1 $2" == "simctl shutdown" ]]; then',
      '  exit 0',
      'elif [[ "$1 $2" == "simctl delete" ]]; then',
      '  touch "$DELETED/$3"',
      'else',
      '  exit 97',
      'fi',
    ].join('\n'),
  );
  const identityPath = join(context.artifacts, 'simulator.udid');
  const targetsPath = join(context.artifacts, 'simulator-targets.txt');
  const workerIdsPath = join(context.artifacts, 'release-worker-simulators.txt');
  const logPath = join(context.artifacts, 'simulator-teardown-details.log');
  try {
    writeFileSync(identityPath, `${base}\n`);
    writeFileSync(targetsPath, `${base}\n`);
    writeFileSync(workerIdsPath, `${workerOne}\n`);
    const result = runTeardown(context, [
      '--identity-file',
      identityPath,
      logPath,
      targetsPath,
      workerIdsPath,
    ]);

    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.deepEqual(readFileSync(targetsPath, 'utf8').trim().split('\n'), [base, workerOne]);
    const calls = readFileSync(context.callsPath, 'utf8');
    for (const simulator of [base, workerOne]) {
      assert.match(calls, new RegExp(`simctl delete ${simulator}`));
    }
    assert.doesNotMatch(calls, new RegExp(`simctl delete ${unrelated}`));
  } finally {
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test('does not target worker IDs when the dedicated base identity was never recorded', () => {
  const context = fixture('exit 97');
  const identityPath = join(context.artifacts, 'simulator.udid');
  const targetsPath = join(context.artifacts, 'simulator-targets.txt');
  const workerIdsPath = join(context.artifacts, 'release-worker-simulators.txt');
  const logPath = join(context.artifacts, 'simulator-teardown-details.log');
  try {
    writeFileSync(workerIdsPath, `${workerOne}\n`);
    const result = runTeardown(context, [
      '--identity-file',
      identityPath,
      logPath,
      targetsPath,
      workerIdsPath,
    ]);

    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(readFileSync(logPath, 'utf8'), /no device will be targeted/);
    assert.equal(existsSync(context.callsPath), false);
    assert.equal(existsSync(targetsPath), false);
  } finally {
    rmSync(context.directory, { recursive: true, force: true });
  }
});
