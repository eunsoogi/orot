import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { workflow } from './fixtures/ios-workflow.mjs';
import { iosTestInventory } from '../ios-test-inventory.mjs';

test('host regressions retain every migrated test outside the iOS inventory', () => {
  const runner = readFileSync('scripts/tests/native-swift-regressions-host.sh', 'utf8');
  const candidates = {
    MedicationDoseCursorTests: [
      'testCatalogShrinkageAndEmptyVisibilityRetainDeletionScope',
      'testReplayExpansionAndErrorsPreserveCheckpointInvariants',
    ],
    AppleNativeToolLifecycleTests: [
      'testCallbackResultDrainsBeforeFreshGeneration',
      'testCancellationReleasesWaitingCallback',
      'testDrainFailureDoesNotStartFreshGeneration',
      'testSecondCallbackDuringDrainIsRejected',
      'testCancellationDuringDrainReleasesTheNextRequest',
      'testWatchdogReleasesAnOrphanedCallback',
      'testParallelCallbackFailsWithoutPublishingAnotherTool',
    ],
  };
  const inventory = iosTestInventory('provider-data');
  const unitWorkflow = workflow('.github/workflows/unit-test.yml');
  const host = unitWorkflow.jobs.host_regressions;
  // Runner choice must not create a fourth test level or duplicate execution.
  assert.equal(existsSync('.github/workflows/native-swift-host.yml'), false);
  assert.equal(host.name, 'Swift host regressions');
  assert.equal(host['runs-on'], 'xcode-27');
  assert.equal(host.env.DEVELOPER_DIR, '/Applications/Xcode_27.2.app/Contents/Developer');
  assert.equal(host['timeout-minutes'], 15);
  assert.equal(host.needs, undefined);
  assert.equal(host.if, undefined);
  assert.deepEqual(unitWorkflow.permissions, { contents: 'read' });
  const commands = host.steps.filter((step) => step.run).map((step) => step.run);
  assert.deepEqual(commands, [
    'swift scripts/tests/host-file-protection-capability.swift',
    'scripts/tests/native-swift-regressions-host.sh',
  ]);
  const project = readFileSync('apps/mobile/ios/OrotMobile.xcodeproj/project.pbxproj', 'utf8');
  for (const [suite, methods] of Object.entries(candidates)) {
    const source = readFileSync(`scripts/tests/${suite}.swift`, 'utf8');
    assert.ok(runner.includes(suite), `Host runner must include ${suite}`);
    assert.ok(!project.includes(`${suite}.swift`), `iOS target must not compile ${suite}`);
    assert.deepEqual(
      [...source.matchAll(/func (test\w+)\(/g)].map((match) => match[1]).sort(),
      [...methods].sort(),
    );
    for (const method of methods) {
      assert.ok(source.includes(`func ${method}(`), `Missing original ${suite}/${method}`);
      assert.ok(!inventory.includes(`OrotIntegrationTests/${suite}/${method}`));
    }
  }
});
