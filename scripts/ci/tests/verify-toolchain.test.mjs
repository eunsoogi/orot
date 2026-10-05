import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const verifyToolchain = join(repositoryRoot, 'scripts/ci/verify-toolchain.sh');

function runVerifier(args, simulatorAvailable = true) {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'orot-toolchain-'));
  const binDirectory = join(fixtureRoot, 'bin');
  const callsPath = join(fixtureRoot, 'calls.log');
  const commandStubs = {
    node: "printf '22.23.2\\n'",
    pnpm: "printf '12.3.4\\n'",
    sw_vers: "printf '27.0\\n'",
    xcodebuild: "printf 'Xcode 27.0\\nBuild version 27A1\\n'",
    ruby: "printf '4.0.7'",
    pod: "printf '1.17.0\\n'",
    xcrun: [
      'if [[ "$1" == "--sdk" ]]; then printf "27.0\\n"; exit 0; fi',
      'if [[ "$1" == "simctl" && "${SIMULATOR_AVAILABLE}" == "true" ]]; then printf "iPhone 18 Pro\\n"; exit 0; fi',
      'if [[ "$1" == "simctl" ]]; then printf "iPhone 17\\n"; exit 0; fi',
      'exit 2',
    ].join('\n'),
  };

  try {
    mkdirSync(binDirectory);
    for (const [command, body] of Object.entries(commandStubs)) {
      const path = join(binDirectory, command);
      writeFileSync(
        path,
        `#!/bin/bash\nprintf '%s\\n' '${command} '"$*" >> "$TOOLCHAIN_CALL_LOG"\n${body}\n`,
      );
      chmodSync(path, 0o755);
    }

    const result = spawnSync('bash', [verifyToolchain, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        DEVELOPER_DIR: '/Applications/Xcode.app/Contents/Developer',
        PATH: `${binDirectory}:${process.env.PATH}`,
        SIMULATOR_AVAILABLE: String(simulatorAvailable),
        TOOLCHAIN_CALL_LOG: callsPath,
      },
    });

    return {
      ...result,
      calls: readFileSync(callsPath, 'utf8'),
    };
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

test('default toolchain verification still requires the available iPhone simulator', () => {
  const result = runVerifier([], false);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Toolchain mismatch for iPhone-Simulator/);
  assert.match(result.calls, /xcrun simctl list devices available/);
});

test('profile verification can skip only the availability listing during async boot', () => {
  // Profile setup already creates the exact device; the later bootstatus step checks readiness.
  const result = runVerifier(['--skip-simulator-availability'], false);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.calls, /xcrun --sdk iphonesimulator --show-sdk-version/);
  assert.doesNotMatch(result.calls, /xcrun simctl list devices available/);
});

test('skipping the listing does not disable native Ruby and CocoaPods verification', () => {
  const result = runVerifier(['--skip-simulator-availability', '--cocoapods'], false);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.calls, /ruby -e print RUBY_VERSION/);
  assert.match(result.calls, /pod --version/);
  assert.doesNotMatch(result.calls, /xcrun simctl list devices available/);
});
