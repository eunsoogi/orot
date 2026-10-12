import assert from 'node:assert/strict';
import test from 'node:test';
import { iosTestBuildSpec } from '../ios-test-config.mjs';
import { verifyTestRunContract } from '../ios-test-run-contract.mjs';

const spec = iosTestBuildSpec('core');
function observedFormatOne() {
  const app = '__TESTROOT__/Release-iphonesimulator/Orot.app';
  const runner = '__TESTROOT__/Release-iphonesimulator/OrotUITests-Runner.app';
  const shared = {
    CommandLineArguments: ['-OROT_TEST_HOST', 'YES'],
    DependentProductPaths: [
      app,
      app + '/PlugIns/OrotIntegrationTests.xctest',
      runner,
      runner + '/PlugIns/OrotUITests.xctest',
    ],
  };
  return {
    __xctestrun_metadata__: {
      FormatVersion: 1,
      ContainerInfo: { ContainerName: 'OrotMobile', SchemeName: 'OrotTests' },
    },
    OrotIntegrationTests: {
      ...shared,
      BlueprintName: 'OrotIntegrationTests',
      IsAppHostedTestBundle: true,
      TestHostPath: app,
      TestBundlePath: '__TESTHOST__/PlugIns/OrotIntegrationTests.xctest',
    },
    OrotUITests: {
      ...shared,
      BlueprintName: 'OrotUITests',
      IsUITestBundle: true,
      IsXCTRunnerHostedTestBundle: true,
      TestHostPath: runner,
      TestBundlePath: '__TESTHOST__/PlugIns/OrotUITests.xctest',
      UITargetAppPath: app,
    },
  };
}
test('accepts the actual scheme-based format 1 target and app-hosted flag layout', () => {
  assert.equal(verifyTestRunContract(observedFormatOne(), spec).length, 2);
});
test('rejects other versions, missing targets and lost native host isolation', () => {
  for (const mutate of [
    (data) => {
      data.__xctestrun_metadata__.FormatVersion = 2;
    },
    (data) => {
      delete data.OrotUITests;
    },
    (data) => {
      data.OrotIntegrationTests.IsAppHostedTestBundle = false;
    },
    (data) => {
      data.OrotIntegrationTests.CommandLineArguments = [];
    },
  ]) {
    const data = observedFormatOne();
    mutate(data);
    assert.throws(() => verifyTestRunContract(data, spec));
  }
});
test('rejects escaped, stale configuration and extra dependency paths', () => {
  for (const mutate of [
    (data) => {
      data.OrotUITests.UITargetAppPath = '__TESTROOT__/../outside/Orot.app';
    },
    (data) => {
      data.OrotIntegrationTests.TestHostPath = '__TESTROOT__/Debug-iphonesimulator/Orot.app';
    },
    (data) => {
      data.OrotUITests.DependentProductPaths = ['__TESTROOT__/unexpected.app'];
    },
    (data) => {
      data.__xctestrun_metadata__.ContainerInfo.SchemeName = 'OtherTests';
    },
  ]) {
    const data = observedFormatOne();
    mutate(data);
    assert.throws(() => verifyTestRunContract(data, spec));
  }
});
