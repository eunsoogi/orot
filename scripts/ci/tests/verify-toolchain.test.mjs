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
  assert.match(result.stdout, /Observed macOS release 26\.6\.2 \(cache identity, not a gate\)/);
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

const acceptedHostProfiles = [
  {
    macosVersion: '26.6.2',
    developerDir: '/Applications/Xcode_26.2.app/Contents/Developer',
    xcodeVersion: '26.2',
    simulatorSdk: '26.2',
    runtime: runtime26,
    device: transcriptionSimulator,
  },
  ...['27.0', '27.0.1', '27.3.4', '99.17.42'].map((macosVersion) => ({
    macosVersion,
    developerDir: '/Applications/Xcode.app/Contents/Developer',
    xcodeVersion: '27.0',
    simulatorSdk: '27.0',
    runtime: runtime27,
    device: currentSimulator,
  })),
];

for (const profile of acceptedHostProfiles) {
  test(`records macOS ${profile.macosVersion} without gating the pinned toolchain`, () => {
    // The OS release is evidence/cache identity; exact Xcode and Simulator pins remain the gate.
    const result = runToolchainCheck(
      {
        DEVELOPER_DIR: profile.developerDir,
        SIMULATED_MACOS_VERSION: profile.macosVersion,
        EXPECTED_XCODE_VERSION: profile.xcodeVersion,
        EXPECTED_IOS_SIMULATOR_SDK: profile.simulatorSdk,
        EXPECTED_IOS_SIMULATOR_RUNTIME_NAME: profile.runtime.name,
        EXPECTED_IOS_SIMULATOR_RUNTIME_IDENTIFIER: profile.runtime.identifier,
        EXPECTED_DETOX_SIMULATOR_DEVICE_NAME: profile.device.name,
        EXPECTED_DETOX_SIMULATOR_DEVICE_TYPE_ID: profile.device.deviceTypeIdentifier,
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
    assert.ok(
      result.stdout.includes(
        `Observed macOS release ${profile.macosVersion} (cache identity, not a gate); verified Xcode ${profile.xcodeVersion}`,
      ),
    );
    assert.ok(result.stdout.includes(`device ${profile.device.name}`));
    // Keep the complete observed release in the output consumed by cache keys and evidence.
    assert.equal(
      result.githubOutput,
      `macos_version=${profile.macosVersion}\nxcodebuild_fingerprint=${expectedXcodeBuildFingerprint(profile.xcodeVersion)}\n`,
    );
  });
}

test('still rejects a missing pinned Simulator runtime on macOS 99.17.42', () => {
  const result = runToolchainCheck(
    {
      DEVELOPER_DIR: '/Applications/Xcode_26.2.app/Contents/Developer',
      SIMULATED_MACOS_VERSION: '99.17.42',
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

test('still rejects a mismatched Xcode version on macOS 99.17.42', () => {
  const result = runToolchainCheck(
    {
      DEVELOPER_DIR: '/Applications/Xcode.app/Contents/Developer',
      SIMULATED_MACOS_VERSION: '99.17.42',
      SIMULATED_XCODE_VERSION: '28.0',
      EXPECTED_XCODE_VERSION: '27.0',
      EXPECTED_IOS_SIMULATOR_SDK: '27.0',
    },
    {
      availableRuntimes: [runtime27],
      availableDevices: { [runtime27.identifier]: [currentSimulator] },
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Toolchain mismatch for Xcode: expected 27\.0, got 28\.0/);
});

test('includes the complete Xcode build string in its cache fingerprint', () => {
  const profile = {
    DEVELOPER_DIR: '/Applications/Xcode.app/Contents/Developer',
    SIMULATED_MACOS_VERSION: '27.0',
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
