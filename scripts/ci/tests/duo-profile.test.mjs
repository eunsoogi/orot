import assert from 'node:assert/strict';
import test from 'node:test';
import { iosTestBuildSpec, iosTestConfig } from '../ios-test-config.mjs';
import { verifyIosSimulatorOwnerContract } from '../ios-test-cohorts.mjs';
import { iosTestExecutionPlan } from '../ios-test-execution-plan.mjs';
import { iosTestInventory } from '../ios-test-inventory.mjs';

// These contracts protect existing jobs while the opt-in profile owns a separate native destination.
test('Duo selects its supported runtime without changing SDK or ordinary destinations', () => {
  const duo = iosTestConfig('duo');
  assert.equal(duo.device, 'com.apple.CoreSimulator.SimDeviceType.iPhone-Duo');
  assert.equal(duo.runtime, 'com.apple.CoreSimulator.SimRuntime.iOS-27-1');
  assert.equal(duo.runtimeBuild, null);
  assert.equal(duo.configuration, 'Release');
  for (const profile of [
    'duo',
    'core',
    'speech',
    'backup',
    'fixtures',
    'local-model',
    'provider-data',
    'health-import',
    'microphone',
    'provider-selection',
  ]) {
    const config = iosTestConfig(profile);
    assert.equal(config.xcode, '27.1');
    assert.equal(config.sdk, '27.1');
    if (profile === 'duo') continue;
    const speech = profile === 'speech';
    assert.equal(
      config.runtime,
      `com.apple.CoreSimulator.SimRuntime.iOS-${speech ? '26-2' : '27-0'}`,
    );
    assert.equal(config.runtimeBuild, speech ? '23C54' : null);
    assert.equal(
      config.device,
      `com.apple.CoreSimulator.SimDeviceType.${speech ? 'iPhone-SE-3rd-generation' : 'iPhone-18-Pro'}`,
    );
    assert.equal(
      config.configuration,
      ['provider-data', 'health-import', 'microphone', 'provider-selection'].includes(profile)
        ? 'Debug'
        : 'Release',
    );
  }
});

test('Duo remains opt-in with its own product compatibility and exact native test inventory', () => {
  const duo = iosTestBuildSpec('duo');
  const core = iosTestBuildSpec('core');
  assert.equal(duo.productProfile, 'ios-test-duo');
  assert.deepEqual(duo.compatibleExecutions, ['duo']);
  assert.deepEqual(core.compatibleExecutions, [
    'core',
    'speech',
    'backup',
    'fixtures',
    'local-model',
  ]);
  assert.deepEqual(iosTestBuildSpec('provider-data').compatibleExecutions, [
    'provider-data',
    'health-import',
    'microphone',
    'provider-selection',
  ]);
  const buildInputs = (spec) =>
    Object.fromEntries(
      Object.entries(spec).filter(
        ([key]) => !['productProfile', 'compatibleExecutions'].includes(key),
      ),
    );
  assert.deepEqual(buildInputs(duo), buildInputs(core));
  assert.deepEqual(iosTestInventory('duo'), [
    'OrotUITests/TestHostConnectionTests/testHostLaunches',
    'OrotUITests/WindowGeometryUITests/testDuoGeometryEventsMatchUIKitAndRetainQuestionDraftAcrossSourceNavigation',
  ]);
  assert.throws(() => iosTestInventory('duo', 'integration'), /Unsupported/);
  assert.throws(() => iosTestInventory('duo', 'navigation'), /Unsupported/);
  assert.ok(iosTestExecutionPlan().every((job) => job.profile !== 'duo'));
});

test('Duo ownership cannot reuse an ordinary iPhone, runtime or cohort receipt', () => {
  const owner = { ...iosTestConfig('duo'), name: 'owned-duo', udid: 'owned-duo-udid' };
  assert.deepEqual(verifyIosSimulatorOwnerContract(owner, 'duo'), iosTestConfig('duo'));
  for (const change of [
    { device: iosTestConfig('core').device },
    { runtime: iosTestConfig('core').runtime },
    { profile: 'core' },
    { cohort: 'core-ui', profiles: ['core'] },
  ]) {
    assert.throws(
      () => verifyIosSimulatorOwnerContract({ ...owner, ...change }, 'duo'),
      /mismatch/,
    );
  }
  assert.throws(() => verifyIosSimulatorOwnerContract(owner, 'core'), /mismatch/);
});
