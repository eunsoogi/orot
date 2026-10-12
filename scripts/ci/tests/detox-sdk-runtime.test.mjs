import assert from 'node:assert/strict';
import test from 'node:test';
import {
  runToolchainCheck,
  runtime26,
  transcriptionSimulator,
} from './verify-toolchain-test-support.mjs';

// An installed runtime and device type suffice: the workflow creates its own device afterward.
test('builds with SDK 27 and validates runtime 26.2 without a precreated Simulator', () => {
  const result = runToolchainCheck(
    {
      DEVELOPER_DIR: '/Applications/Xcode.app/Contents/Developer',
      EXPECTED_XCODE_VERSION: '27.0',
      EXPECTED_IOS_SIMULATOR_SDK: '27.0',
      EXPECTED_IOS_SIMULATOR_RUNTIME_NAME: runtime26.name,
      EXPECTED_IOS_SIMULATOR_RUNTIME_IDENTIFIER: runtime26.identifier,
      EXPECTED_DETOX_SIMULATOR_DEVICE_NAME: transcriptionSimulator.name,
      EXPECTED_DETOX_SIMULATOR_DEVICE_TYPE_ID: transcriptionSimulator.deviceTypeIdentifier,
    },
    {
      availableRuntimes: [runtime26],
      availableDevices: {},
      availableDeviceTypes: [
        {
          name: transcriptionSimulator.name,
          identifier: transcriptionSimulator.deviceTypeIdentifier,
        },
      ],
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SDK 27\.0, runtime iOS 26\.2/);
});
