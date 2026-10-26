import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const helperPath = fileURLToPath(
  new URL('../ios-simulator-biometric-capabilities.sh', import.meta.url),
);

function runCapabilityProbe({ ioHelpExit = '0' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'orot-simulator-capabilities-'));
  const bin = join(root, 'bin');
  const developerDirectory = join(root, 'Xcode');
  const callsPath = join(root, 'simctl-calls.log');
  mkdirSync(bin);
  mkdirSync(join(developerDirectory, 'Applications'), { recursive: true });
  mkdirSync(join(developerDirectory, '..', 'Applications', 'DeviceHub.app'), { recursive: true });

  // Stub the host tools so the helper's argument order and fail-fast behavior run without Xcode.
  const xcodebuildPath = join(bin, 'xcodebuild');
  const xcrunPath = join(bin, 'xcrun');
  writeFileSync(xcodebuildPath, '#!/bin/sh\nprintf "Xcode 27.1\\nBuild version 27B1\\n"\n');
  writeFileSync(
    xcrunPath,
    `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$SIMCTL_HELP_CALLS"
case "$*" in
  'simctl help') printf 'Usage: simctl help [subcommand]\\n' ;;
  'simctl help io')
    if [ "$SIMCTL_IO_HELP_EXIT" -ne 0 ]; then
      printf 'simctl help io failed\\n' >&2
      exit "$SIMCTL_IO_HELP_EXIT"
    fi
    printf 'Usage: simctl io <device> <operation> ...\\n'
    ;;
  *) printf 'unsupported simctl command: %s\\n' "$*" >&2; exit 117 ;;
esac
`,
  );
  chmodSync(xcodebuildPath, 0o755);
  chmodSync(xcrunPath, 0o755);

  try {
    const result = spawnSync('bash', [helperPath], {
      cwd: fileURLToPath(new URL('../../../', import.meta.url)),
      encoding: 'utf8',
      env: {
        ...process.env,
        DEVELOPER_DIR: developerDirectory,
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        SIMCTL_HELP_CALLS: callsPath,
        SIMCTL_IO_HELP_EXIT: ioHelpExit,
      },
    });
    return {
      result,
      calls: readFileSync(callsPath, 'utf8').trim().split('\n'),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('records Simulator help controls and discovers Device Hub beside Developer', () => {
  const { result, calls } = runCapabilityProbe();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Xcode 27\.1/);
  assert.match(result.stdout, /SIMULATOR_GUI_APP=.*DeviceHub\.app/);
  assert.deepEqual(calls, ['simctl help', 'simctl help io']);
});

test('surfaces an actual Simulator help failure before GUI discovery', () => {
  const { result, calls } = runCapabilityProbe({ ioHelpExit: '23' });

  assert.equal(result.status, 23, result.stderr);
  assert.match(result.stderr, /simctl help io failed/);
  assert.doesNotMatch(result.stdout, /SIMULATOR_GUI_APP=/);
  assert.deepEqual(calls, ['simctl help', 'simctl help io']);
});
