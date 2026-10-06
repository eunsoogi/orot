import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const verifyScript = join(repositoryRoot, 'scripts/ci/verify-toolchain.sh');
const currentSimulator = {
  name: 'iPhone 18 Pro',
  deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro',
  isAvailable: true,
};
const transcriptionSimulator = {
  name: 'iPhone 17 Pro',
  deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro',
  isAvailable: true,
};

function runToolchainCheck(profile, { availableRuntimes, availableDevices }, args = []) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-toolchain-'));
  try {
    const githubOutputPath = join(directory, 'github-output');
    writeFileSync(githubOutputPath, '');
    const binDirectory = join(directory, 'bin');
    mkdirSync(binDirectory, { recursive: true });
    const writeCommand = (name, content) => {
      writeFileSync(join(binDirectory, name), `#!/usr/bin/env bash\n${content}\n`, {
        mode: 0o755,
      });
    };
    writeCommand(
      'node',
      'if [[ "$1" == "-p" ]]; then printf \'22.23.2\\n\'; else exec "$REAL_NODE_EXECUTABLE" "$@"; fi',
    );
    writeCommand('pnpm', "printf '12.3.4\\n'");
    writeCommand(
      'sw_vers',
      'printf \'%s\\n\' "${SIMULATED_MACOS_VERSION:-$EXPECTED_MACOS_VERSION}"',
    );
    writeCommand(
      'xcodebuild',
      'printf \'Xcode %s\\nBuild version %s\\n\' "$EXPECTED_XCODE_VERSION" "${SIMULATED_XCODE_BUILD_VERSION:-test}"',
    );
    writeCommand(
      'xcrun',
      [
        'if [[ "$*" == "--sdk iphonesimulator --show-sdk-version" ]]; then',
        '  printf \'%s\\n\' "$EXPECTED_IOS_SIMULATOR_SDK"',
        'elif [[ "$*" == "simctl list runtimes --json" ]]; then',
        '  cat "$SIMULATOR_RUNTIMES_JSON"',
        'elif [[ "$*" == "simctl list devices available --json" ]]; then',
        '  cat "$SIMULATOR_DEVICES_JSON"',
        'else',
        '  exit 97',
        'fi',
      ].join('\n'),
    );
    writeCommand('ruby', 'printf \'%s\\n\' "${SIMULATED_RUBY_VERSION:-$EXPECTED_RUBY_VERSION}"');
    writeCommand(
      'pod',
      'printf \'%s\\n\' "${SIMULATED_COCOAPODS_VERSION:-$EXPECTED_COCOAPODS_VERSION}"',
    );
    const runtimesPath = join(directory, 'runtimes.json');
    const devicesPath = join(directory, 'devices.json');
    writeFileSync(runtimesPath, JSON.stringify({ runtimes: availableRuntimes }));
    writeFileSync(devicesPath, JSON.stringify({ devices: availableDevices }));
    const result = spawnSync('bash', [verifyScript, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: [binDirectory, process.env.PATH].join(':'),
        REAL_NODE_EXECUTABLE: process.execPath,
        GITHUB_OUTPUT: githubOutputPath,
        SIMULATOR_RUNTIMES_JSON: runtimesPath,
        SIMULATOR_DEVICES_JSON: devicesPath,
        EXPECTED_RUBY_VERSION: '4.0.7',
        EXPECTED_COCOAPODS_VERSION: '1.17.0',
        EXPECTED_IOS_SIMULATOR_RUNTIME_NAME: '',
        EXPECTED_IOS_SIMULATOR_RUNTIME_IDENTIFIER: '',
        EXPECTED_DETOX_SIMULATOR_DEVICE_NAME: '',
        EXPECTED_DETOX_SIMULATOR_DEVICE_TYPE_ID: '',
        ...profile,
      },
    });
    return { ...result, githubOutput: readFileSync(githubOutputPath, 'utf8') };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const runtime27 = {
  name: 'iOS 27.0',
  identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-27-0',
  isAvailable: true,
};
const runtime26 = {
  name: 'iOS 26.2',
  identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-2',
  isAvailable: true,
};

function expectedXcodeBuildFingerprint(version, build = 'test') {
  return createHash('sha256').update(`Xcode ${version}\nBuild version ${build}\n`).digest('hex');
}

test('verifies the transcription profile runtime and device against their pinned Xcode', () => {
  const result = runToolchainCheck(
    {
      DEVELOPER_DIR: '/Applications/Xcode_26.2.app/Contents/Developer',
      EXPECTED_MACOS_VERSION: '26',
      SIMULATED_MACOS_VERSION: '26.6.2',
      EXPECTED_XCODE_VERSION: '26.2',
      EXPECTED_IOS_SIMULATOR_SDK: '26.2',
      EXPECTED_IOS_SIMULATOR_RUNTIME_NAME: 'iOS 26.2',
      EXPECTED_IOS_SIMULATOR_RUNTIME_IDENTIFIER: runtime26.identifier,
      EXPECTED_DETOX_SIMULATOR_DEVICE_NAME: transcriptionSimulator.name,
      EXPECTED_DETOX_SIMULATOR_DEVICE_TYPE_ID: transcriptionSimulator.deviceTypeIdentifier,
    },
    {
      availableRuntimes: [runtime27, runtime26],
      availableDevices: {
        [runtime27.identifier]: [currentSimulator],
        [runtime26.identifier]: [transcriptionSimulator],
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Verified macOS 26\.6\.2/);
  assert.equal(
    result.githubOutput,
    `macos_version=26.6.2\nxcodebuild_fingerprint=${expectedXcodeBuildFingerprint('26.2')}\n`,
  );
  assert.match(
    result.stdout,
    /runtime iOS 26\.2 \(com\.apple\.CoreSimulator\.SimRuntime\.iOS-26-2\)/,
  );
  assert.match(
    result.stdout,
    /device iPhone 17 Pro \(com\.apple\.CoreSimulator\.SimDeviceType\.iPhone-17-Pro\)/,
  );
});

test('rejects an unavailable expected runtime even when another iOS runtime is installed', () => {
  const result = runToolchainCheck(
    {
      DEVELOPER_DIR: '/Applications/Xcode_26.2.app/Contents/Developer',
      EXPECTED_MACOS_VERSION: '26',
      SIMULATED_MACOS_VERSION: '26.6.2',
      EXPECTED_XCODE_VERSION: '26.2',
      EXPECTED_IOS_SIMULATOR_SDK: '26.2',
      EXPECTED_IOS_SIMULATOR_RUNTIME_NAME: 'iOS 26.2',
      EXPECTED_IOS_SIMULATOR_RUNTIME_IDENTIFIER: runtime26.identifier,
      EXPECTED_DETOX_SIMULATOR_DEVICE_NAME: transcriptionSimulator.name,
      EXPECTED_DETOX_SIMULATOR_DEVICE_TYPE_ID: transcriptionSimulator.deviceTypeIdentifier,
    },
    {
      availableRuntimes: [runtime27],
      availableDevices: { [runtime27.identifier]: [currentSimulator] },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Toolchain mismatch for iOS-Simulator-runtime/);
});

test('rejects a different macOS major even when the pinned Xcode and runtime exist', () => {
  const result = runToolchainCheck(
    {
      DEVELOPER_DIR: '/Applications/Xcode_26.2.app/Contents/Developer',
      EXPECTED_MACOS_VERSION: '26',
      SIMULATED_MACOS_VERSION: '27.0',
      EXPECTED_XCODE_VERSION: '26.2',
      EXPECTED_IOS_SIMULATOR_SDK: '26.2',
      EXPECTED_IOS_SIMULATOR_RUNTIME_NAME: 'iOS 26.2',
      EXPECTED_IOS_SIMULATOR_RUNTIME_IDENTIFIER: runtime26.identifier,
      EXPECTED_DETOX_SIMULATOR_DEVICE_NAME: transcriptionSimulator.name,
      EXPECTED_DETOX_SIMULATOR_DEVICE_TYPE_ID: transcriptionSimulator.deviceTypeIdentifier,
    },
    {
      availableRuntimes: [runtime26],
      availableDevices: { [runtime26.identifier]: [transcriptionSimulator] },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Toolchain mismatch for macOS: expected 26\.x, got 27\.0/);
});

test('keeps the existing default Release toolchain and Simulator expectation', () => {
  // Omit runtime/device overrides to prove the shell defaults reach Node selectors.
  const result = runToolchainCheck(
    {
      DEVELOPER_DIR: '/Applications/Xcode.app/Contents/Developer',
      EXPECTED_MACOS_VERSION: '27.0',
      EXPECTED_XCODE_VERSION: '27.0',
      EXPECTED_IOS_SIMULATOR_SDK: '27.0',
    },
    {
      availableRuntimes: [runtime27, runtime26],
      availableDevices: {
        [runtime27.identifier]: [currentSimulator],
        [runtime26.identifier]: [transcriptionSimulator],
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /macOS 27\.0, Xcode 27\.0/);
  assert.match(result.stdout, /device iPhone 18 Pro/);
  assert.equal(
    result.githubOutput,
    `macos_version=27.0\nxcodebuild_fingerprint=${expectedXcodeBuildFingerprint('27.0')}\n`,
  );
});

test('includes the complete Xcode build string in its cache fingerprint', () => {
  const profile = {
    DEVELOPER_DIR: '/Applications/Xcode.app/Contents/Developer',
    EXPECTED_MACOS_VERSION: '27.0',
    EXPECTED_XCODE_VERSION: '27.0',
    EXPECTED_IOS_SIMULATOR_SDK: '27.0',
    SIMULATED_XCODE_BUILD_VERSION: 'different-build',
  };
  const result = runToolchainCheck(profile, {
    availableRuntimes: [runtime27],
    availableDevices: { [runtime27.identifier]: [currentSimulator] },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.githubOutput,
    `macos_version=27.0\nxcodebuild_fingerprint=${expectedXcodeBuildFingerprint('27.0', 'different-build')}\n`,
  );
});

test('keeps full runner validation when CocoaPods verification is requested', () => {
  const result = runToolchainCheck(
    {
      DEVELOPER_DIR: '/Applications/Xcode.app/Contents/Developer',
      EXPECTED_MACOS_VERSION: '27.0',
      EXPECTED_XCODE_VERSION: '27.0',
      EXPECTED_IOS_SIMULATOR_SDK: '27.0',
    },
    {
      availableRuntimes: [runtime27],
      availableDevices: { [runtime27.identifier]: [currentSimulator] },
    },
    ['--cocoapods'],
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Verified macOS 27\.0, Xcode 27\.0/);
  assert.match(result.stdout, /Verified Ruby 4\.0\.7 and CocoaPods 1\.17\.0/);
});

test('checks only Ruby and CocoaPods after the full runner check', () => {
  // An empty DEVELOPER_DIR proves this path does not repeat Xcode or Simulator validation.
  const result = runToolchainCheck(
    {
      DEVELOPER_DIR: '',
      EXPECTED_RUBY_VERSION: '4.0.7',
      EXPECTED_COCOAPODS_VERSION: '1.17.0',
    },
    { availableRuntimes: [], availableDevices: {} },
    ['--cocoapods-only'],
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'Verified Ruby 4.0.7 and CocoaPods 1.17.0\n');
  assert.equal(result.githubOutput, '');
});

test('rejects an unexpected Ruby version in the reduced verification mode', () => {
  const result = runToolchainCheck(
    {
      EXPECTED_RUBY_VERSION: '4.0.7',
      EXPECTED_COCOAPODS_VERSION: '1.17.0',
      SIMULATED_RUBY_VERSION: '3.3.0',
    },
    { availableRuntimes: [], availableDevices: {} },
    ['--cocoapods-only'],
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Toolchain mismatch for Ruby: expected 4\.0\.7, got 3\.3\.0/);
});

test('rejects an unexpected CocoaPods version in the reduced verification mode', () => {
  const result = runToolchainCheck(
    {
      EXPECTED_RUBY_VERSION: '4.0.7',
      EXPECTED_COCOAPODS_VERSION: '1.17.0',
      SIMULATED_COCOAPODS_VERSION: '1.16.2',
    },
    { availableRuntimes: [], availableDevices: {} },
    ['--cocoapods-only'],
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Toolchain mismatch for CocoaPods: expected 1\.17\.0, got 1\.16\.2/);
});
