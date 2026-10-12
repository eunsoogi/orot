import assert from 'node:assert/strict';
import test from 'node:test';
import { hostConnectionTest, isIosHostPreparation } from '../ios-test-preparation-contract.mjs';

test('preparation is restricted to exactly one non-mutating connection case and cannot select a product suite', () => {
  assert.equal(isIosHostPreparation([hostConnectionTest], undefined), false);
  assert.equal(isIosHostPreparation([hostConnectionTest], 'prepare-ui'), true);
  for (const [tests, phase] of [
    [[hostConnectionTest], 'unknown'],
    [[], 'prepare-ui'],
    [[hostConnectionTest, hostConnectionTest], 'prepare-ui'],
    [
      ['OrotUITests/BackupPersistenceUITests/testKeyAndMemoryTombstonesSurviveProcessRestart'],
      'prepare-ui',
    ],
  ])
    assert.throws(
      () => isIosHostPreparation(tests, phase),
      /Invalid native host preparation selection/,
    );
});
