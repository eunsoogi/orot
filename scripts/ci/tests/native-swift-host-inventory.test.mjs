import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
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
  const workflow = readFileSync('.github/workflows/native-swift-host.yml', 'utf8');
  const project = readFileSync('apps/mobile/ios/OrotMobile.xcodeproj/project.pbxproj', 'utf8');
  assert.ok(workflow.includes('scripts/tests/native-swift-regressions-host.sh'));
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
