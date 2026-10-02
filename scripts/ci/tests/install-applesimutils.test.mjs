import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const installScript = fileURLToPath(new URL('../install-applesimutils.sh', import.meta.url));

function runInstaller(reportedVersion) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-applesimutils-'));
  const brew = join(directory, 'brew');
  const applesimutils = join(directory, 'applesimutils');
  try {
    writeFileSync(brew, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    writeFileSync(applesimutils, `#!/bin/sh\nprintf 'applesimutils version ${reportedVersion}\\n'\n`, { mode: 0o755 });
    return spawnSync('bash', [installScript], {
      encoding: 'utf8',
      env: {
        ...process.env,
        EXPECTED_APPLESIMUTILS_VERSION: '0.9.12',
        PATH: `${directory}:${process.env.PATH}`,
      },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('installer accepts the pinned AppleSimulatorUtils version and rejects drift', () => {
  const expected = runInstaller('0.9.12');
  assert.equal(expected.status, 0, expected.stderr);

  const drifted = runInstaller('0.9.13');
  assert.notEqual(drifted.status, 0);
  assert.match(drifted.stderr, /AppleSimulatorUtils version mismatch/);
});
