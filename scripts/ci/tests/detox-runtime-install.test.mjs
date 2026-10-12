import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('../prepare-detox-runtime.sh', import.meta.url));

// Stub the asset download, not the native speech result, to exercise provisioning failures safely.
function runPreparation(profile, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-runtime-install-'));
  try {
    const bin = join(directory, 'bin');
    mkdirSync(bin);
    const log = join(directory, 'commands');
    writeFileSync(log, '');
    const installed = join(directory, 'installed');
    if (options.installed) writeFileSync(installed, 'yes');
    const command = (name, body) =>
      writeFileSync(join(bin, name), `#!/usr/bin/env bash\nset -eu\n${body}\n`, { mode: 0o755 });
    command(
      'xcrun',
      `
printf '%s\\n' "xcrun $*" >> "$COMMAND_LOG"
[[ "$*" == 'simctl list runtimes --json' ]] || exit 97
[[ "$LIST_FAILURE" != true ]] || exit 9
if [[ -f "$INSTALLED" ]]; then
  printf '%s\\n' '{"runtimes":[{"identifier":"com.apple.CoreSimulator.SimRuntime.iOS-26-2","isAvailable":true}]}'
else
  printf '%s\\n' '{"runtimes":[]}'
fi`,
    );
    command(
      'xcodebuild',
      `
printf '%s\\n' "xcodebuild $*" >> "$COMMAND_LOG"
[[ "$*" == '-downloadPlatform iOS -buildVersion 26.2 -architectureVariant arm64' ]] || exit 97
[[ "$DOWNLOAD_FAILURE" != true ]] || exit 8
if [[ "$MISSING_AFTER_DOWNLOAD" != true ]]; then touch "$INSTALLED"; fi`,
    );
    const result = spawnSync('bash', [script, profile], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        COMMAND_LOG: log,
        INSTALLED: installed,
        GITHUB_ACTIONS: 'true',
        LIST_FAILURE: String(options.listFailure ?? false),
        DOWNLOAD_FAILURE: String(options.downloadFailure ?? false),
        MISSING_AFTER_DOWNLOAD: String(options.missingAfterDownload ?? false),
      },
    });
    return { ...result, commands: readFileSync(log, 'utf8') };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('installs the pinned speech runtime only when missing and verifies it afterward', () => {
  const result = runPreparation('transcription');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.commands,
    [
      'xcrun simctl list runtimes --json',
      'xcodebuild -downloadPlatform iOS -buildVersion 26.2 -architectureVariant arm64',
      'xcrun simctl list runtimes --json',
      '',
    ].join('\n'),
  );
});

test('reuses an installed runtime and leaves other profiles untouched', () => {
  const installed = runPreparation('transcription', { installed: true });
  assert.equal(installed.status, 0, installed.stderr);
  assert.doesNotMatch(installed.commands, /xcodebuild/);
  const other = runPreparation('release');
  assert.equal(other.status, 0, other.stderr);
  assert.equal(other.commands, '');
});

test('does not interpret inventory failure as permission to download', () => {
  const result = runPreparation('transcription', { listFailure: true });
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.commands, /xcodebuild/);
});

test('fails on download failure or a runtime still unavailable afterward', () => {
  for (const options of [{ downloadFailure: true }, { missingAfterDownload: true }]) {
    const result = runPreparation('transcription', options);
    assert.notEqual(result.status, 0);
    assert.match(result.commands, /xcodebuild -downloadPlatform/);
  }
});
