import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { buildIosTestRunSummary } from '../ios-test-run-summary.mjs';
import { readSourceInventory } from '../ios-test-run-source-inventory.mjs';
import { summarizeIosTestRunTiming } from '../ios-test-run-timing.mjs';
import { sourceInventory } from './ios-source-inventory-fixture.mjs';

test('archived observations remain in source coverage and timing when publisher inventory changed', () => {
  const context = { sourceSha: 'd'.repeat(40), runId: '88', attempt: '1' };
  const report = {
    ...context,
    cohort: 'core-integration',
    tasks: [
      {
        profile: 'core',
        suite: 'legacy',
        status: 'failed',
        elapsedMs: 3000,
        firstFailure: { identifier: 'Legacy/Removed/testCase', result: 'Failed', duration: 2 },
        observations: [{ identifier: 'Legacy/Removed/testCase', result: 'Failed', duration: 2 }],
      },
    ],
  };
  const summary = buildIosTestRunSummary({
    selectedCohorts: ['core-integration'],
    reports: [{ report }],
    context,
    inventory: sourceInventory,
  });
  const row = summary.cases.find((item) => item.identifier === 'Legacy/Removed/testCase');
  assert.equal(row.status, 'failed');
  assert.equal(row.durationMs, 2000);
  assert.ok(!summary.unexpectedObservations.some((item) => item.identifier === row.identifier));
  assert.ok(summary.expensiveCases.some((item) => item.identifier === row.identifier));
  assert.equal(summary.firstFailures[0].observation.identifier, row.identifier);
  const timing = summarizeIosTestRunTiming({
    summary,
    reports: [{ report }],
    selectedCohorts: ['core-integration'],
    inventory: sourceInventory,
  });
  assert.equal(timing.observedTaskElapsedMs, 3000);
  assert.equal(
    timing.expectedTaskElapsedTaskCount,
    sourceInventory.tasks('core-integration').length,
  );
});

test('source inventory refuses an absent or mismatched checkout', async () => {
  await assert.rejects(
    readSourceInventory(undefined, 'a'.repeat(40)),
    /requires the source revision checkout/,
  );
  await assert.rejects(readSourceInventory(process.cwd(), 'a'.repeat(40)), /does not match/);
});

test('source inventory loads the checked out revision after verifying its identity', async () => {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const loaded = await readSourceInventory(process.cwd(), head);
  assert.ok(loaded.names.includes('provider'));
  assert.ok(loaded.tasks('provider').length > 0);
});
