import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const installScript = fileURLToPath(new URL('../install-applesimutils.sh', import.meta.url));

function runInstaller(reportedVersion) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-applesimutils-'));
  const brew = join(directory, 'brew');
  const brewLog = join(directory, 'brew.log');
  const applesimutils = join(directory, 'applesimutils');
  try {
    writeFileSync(brew, '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$BREW_LOG"\n', { mode: 0o755 });
    writeFileSync(
      applesimutils,
      `#!/bin/sh\nprintf 'applesimutils version ${reportedVersion}\\n'\n`,
      { mode: 0o755 },
    );
    const result = spawnSync('bash', [installScript], {
      encoding: 'utf8',
      env: {
        ...process.env,
        EXPECTED_APPLESIMUTILS_VERSION: '0.9.12',
        BREW_LOG: brewLog,
        PATH: `${directory}:${process.env.PATH}`,
      },
    });
    return { result, brewCalls: readFileSync(brewLog, 'utf8').trim().split('\n') };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('installer trusts only the required formula, pins its version, and rejects drift', () => {
  const expected = runInstaller('0.9.12');
  assert.equal(expected.result.status, 0, expected.result.stderr);
  assert.deepEqual(expected.brewCalls, [
    'tap wix/brew',
    'trust --formula wix/brew/applesimutils',
    'install applesimutils',
  ]);

  const drifted = runInstaller('0.9.13');
  assert.notEqual(drifted.result.status, 0);
  assert.match(drifted.result.stderr, /AppleSimulatorUtils version mismatch/);
});
