import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import test from 'node:test';
import { fixture } from './fixtures/ios-test-runner.mjs';
import { iosTestInventory } from '../ios-test-inventory.mjs';
import { hostConnectionTest } from '../ios-test-preparation-contract.mjs';

// The control never enters the default suite or a different destination.
test('rotation control is admitted only as an explicit single Duo diagnostic', () => {
  const control = 'OrotUITests/TestHostConnectionTests/testSystemBrowserRotationControl';
  const enabled = {
    OROT_IOS_TEST_PHASE: 'rotation-control',
    TEST_RUNNER_OROT_ROTATION_CONTROL: 'YES',
  };
  assert.ok(!iosTestInventory('duo').includes(control));
  for (const [profile, selected, env, accepted] of [
    ['duo', [control], enabled, true],
    ['duo', [control], {}, false],
    ['core', [control], enabled, false],
    ['core', [control], { TEST_RUNNER_OROT_ROTATION_CONTROL: 'YES' }, false],
    ['duo', [control, hostConnectionTest], enabled, false],
  ]) {
    const run = fixture(0, profile, 'all', selected, env);
    try {
      assert.equal(run.outcome.status === 0, accepted, run.outcome.stderr);
      assert.equal(
        run.calls.some((call) => call.name === 'xcodebuild'),
        accepted,
      );
    } finally {
      rmSync(run.directory, { recursive: true, force: true });
    }
  }
});
