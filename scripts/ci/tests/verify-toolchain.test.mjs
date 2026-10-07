import assert from 'node:assert/strict';
import test from 'node:test';
import {
  currentSimulator,
  expectedXcodeBuildFingerprint,
  runToolchainCheck,
  runtime26,
  runtime27,
  transcriptionSimulator,
} from './verify-toolchain-test-support.mjs';

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

test('verifies the Release toolchain against its configured macOS major family', () => {
  // Omit runtime/device overrides to prove the shell defaults reach Node selectors.
  const result = runToolchainCheck(
    {
      DEVELOPER_DIR: '/Applications/Xcode.app/Contents/Developer',
      EXPECTED_MACOS_VERSION: '27',
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
  assert.match(result.stdout, /macOS 27, Xcode 27\.0/);
  assert.match(result.stdout, /device iPhone 18 Pro/);
  assert.equal(
    result.githubOutput,
    `macos_version=27\nxcodebuild_fingerprint=${expectedXcodeBuildFingerprint('27.0')}\n`,
  );
});

test('accepts a hosted macOS patch update and records its full cache identity', () => {
  const result = runToolchainCheck(
    {
      DEVELOPER_DIR: '/Applications/Xcode.app/Contents/Developer',
      EXPECTED_MACOS_VERSION: '27',
      SIMULATED_MACOS_VERSION: '27.0.1',
      EXPECTED_XCODE_VERSION: '27.0',
      EXPECTED_IOS_SIMULATOR_SDK: '27.0',
    },
    {
      availableRuntimes: [runtime27],
      availableDevices: { [runtime27.identifier]: [currentSimulator] },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Verified macOS 27\.0\.1, Xcode 27\.0/);
  // Keep the hosted patch in the output consumed by cache keys and evidence.
  assert.equal(
    result.githubOutput,
    `macos_version=27.0.1\nxcodebuild_fingerprint=${expectedXcodeBuildFingerprint('27.0')}\n`,
  );
});

test('rejects a different macOS major for the hosted runner family', () => {
  const result = runToolchainCheck(
    {
      DEVELOPER_DIR: '/Applications/Xcode.app/Contents/Developer',
      EXPECTED_MACOS_VERSION: '27',
      SIMULATED_MACOS_VERSION: '28.0.1',
      EXPECTED_XCODE_VERSION: '27.0',
      EXPECTED_IOS_SIMULATOR_SDK: '27.0',
    },
    {
      availableRuntimes: [runtime27],
      availableDevices: { [runtime27.identifier]: [currentSimulator] },
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Toolchain mismatch for macOS: expected 27\.x, got 28\.0\.1/);
});

test('keeps dotted macOS expectations exact when a patch version is pinned', () => {
  const result = runToolchainCheck(
    {
      DEVELOPER_DIR: '/Applications/Xcode.app/Contents/Developer',
      EXPECTED_MACOS_VERSION: '27.0',
      SIMULATED_MACOS_VERSION: '27.0.1',
      EXPECTED_XCODE_VERSION: '27.0',
      EXPECTED_IOS_SIMULATOR_SDK: '27.0',
    },
    {
      availableRuntimes: [runtime27],
      availableDevices: { [runtime27.identifier]: [currentSimulator] },
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Toolchain mismatch for macOS: expected 27\.0, got 27\.0\.1/);
});

test('includes the complete Xcode build string in its cache fingerprint', () => {
  const profile = {
    DEVELOPER_DIR: '/Applications/Xcode.app/Contents/Developer',
    EXPECTED_MACOS_VERSION: '27',
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
    `macos_version=27\nxcodebuild_fingerprint=${expectedXcodeBuildFingerprint('27.0', 'different-build')}\n`,
  );
  assert.equal(
    result.githubEnvironment,
    `XCODEBUILD_FINGERPRINT=${expectedXcodeBuildFingerprint('27.0', 'different-build')}\n`,
  );
});

test('verifies the Linux portable quality runner without consulting Apple tools', () => {
  const result = runToolchainCheck(
    {
      EXPECTED_RUBY_VERSION: '4.0.7',
      SIMULATED_UNAME_SYSTEM: 'Linux',
      SIMULATED_UNAME_ARCH: 'x86_64',
    },
    { availableRuntimes: [], availableDevices: {} },
    ['--portable'],
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /Verified Linux x86_64, Node 22\.23\.2, pnpm 12\.3\.4, and Ruby 4\.0\.7/,
  );
  assert.equal(result.githubOutput, '');
  assert.equal(result.githubEnvironment, '');
});

test('rejects a non-Linux or non-x64 runner for the portable pinned assets', () => {
  for (const profile of [
    { SIMULATED_UNAME_SYSTEM: 'Darwin' },
    { SIMULATED_UNAME_SYSTEM: 'Linux', SIMULATED_UNAME_ARCH: 'aarch64' },
  ]) {
    const result = runToolchainCheck(
      { EXPECTED_RUBY_VERSION: '4.0.7', ...profile },
      { availableRuntimes: [], availableDevices: {} },
      ['--portable'],
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Toolchain mismatch for (OS|architecture)/);
  }
});
