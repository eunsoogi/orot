import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { iosTestInventory } from '../ios-test-inventory.mjs';

test('host candidates retain their original iOS inventory and source assertions', () => {
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
  for (const [suite, methods] of Object.entries(candidates)) {
    const source = readFileSync(`apps/mobile/ios/OrotIntegrationTests/${suite}.swift`, 'utf8');
    assert.ok(runner.includes(suite), `Host runner must include ${suite}`);
    for (const method of methods) {
      assert.ok(source.includes(`func ${method}(`), `Missing original ${suite}/${method}`);
      assert.ok(inventory.includes(`OrotIntegrationTests/${suite}/${method}`));
    }
  }
});
