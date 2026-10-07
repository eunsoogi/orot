import assert from 'node:assert/strict';
import test from 'node:test';
import {
  currentSimulator,
  runToolchainCheck,
  runtime27,
} from './verify-toolchain-test-support.mjs';

test('keeps full runner validation when CocoaPods verification is requested', () => {
  const result = runToolchainCheck(
    {
      DEVELOPER_DIR: '/Applications/Xcode.app/Contents/Developer',
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
  assert.match(
    result.stdout,
    /Observed macOS release 27\.0 \(cache identity, not a gate\); verified Xcode 27\.0/,
  );
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
