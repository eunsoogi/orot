import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import test from 'node:test';
import { sharedPersistenceBatches } from '../shared-persistence-test-phases.mjs';
import { fixture } from './fixtures/ios-test-runner.mjs';

function environment(index) {
  const phase = ['seed', 'resume', 'absence'][index];
  return {
    OROT_IOS_SHARED_PERSISTENCE_PHASE: phase,
    OROT_IOS_STATE_PHASE: phase,
    TEST_RUNNER_OROT_STATE_FIXTURE: 'test-persistence-11111111-2222-4333-8444-555555555555',
    TEST_RUNNER_OROT_STATE_MEMORY_FIXTURE: 'test-memory-11111111-2222-4333-8444-666666666666',
    TEST_RUNNER_OROT_STATE_PREVIOUS_PIDS: JSON.stringify(
      index === 0 ? [] : index === 1 ? [10] : [10, 11],
    ),
    ...(index > 0 ? { OROT_IOS_RECORDING_PHASE: index === 1 ? 'seed' : 'read' } : {}),
    ...(index === 2 ? { TEST_RUNNER_OROT_RECORDING_BASELINE: '{"captured":"seed receipt"}' } : {}),
  };
}

test('the runner executes each exact shared phase once and propagates its first Xcode failure', () => {
  for (const [index, selected] of sharedPersistenceBatches.entries()) {
    const value = fixture(65, 'core', 'shared-persistence', selected, environment(index));
    try {
      assert.equal(value.outcome.status, 65, value.outcome.stderr);
      const calls = value.calls.filter((call) => call.name === 'xcodebuild');
      assert.equal(calls.length, 1);
      assert.deepEqual(
        calls[0].args.filter((arg) => arg.startsWith('-only-testing:')),
        selected.map((id) => '-only-testing:' + id),
      );
    } finally {
      rmSync(value.directory, { recursive: true, force: true });
    }
  }
});

test('partial, crossed or repeated phases and missing receipt inputs never reach Xcode', () => {
  const valid = environment(2);
  for (const [selected, env] of [
    [sharedPersistenceBatches.flat(), valid],
    [[sharedPersistenceBatches[2][0]], valid],
    [[sharedPersistenceBatches[2][1]], valid],
    [[...sharedPersistenceBatches[2], sharedPersistenceBatches[2][1]], valid],
    [sharedPersistenceBatches[1], valid],
    [sharedPersistenceBatches[2], { ...valid, OROT_IOS_STATE_PHASE: 'seed' }],
    [sharedPersistenceBatches[2], { ...valid, OROT_IOS_RECORDING_PHASE: 'seed' }],
    ...[
      'TEST_RUNNER_OROT_STATE_FIXTURE',
      'TEST_RUNNER_OROT_STATE_MEMORY_FIXTURE',
      'TEST_RUNNER_OROT_STATE_PREVIOUS_PIDS',
      'TEST_RUNNER_OROT_RECORDING_BASELINE',
    ].map((key) => [sharedPersistenceBatches[2], { ...valid, [key]: '' }]),
  ]) {
    const value = fixture(0, 'core', 'shared-persistence', selected, env);
    try {
      assert.notEqual(value.outcome.status, 0);
      assert.match(value.outcome.stderr, /exact host-orchestrated process batch/);
      assert.ok(!value.calls.some((call) => call.name === 'xcodebuild'));
    } finally {
      rmSync(value.directory, { recursive: true, force: true });
    }
  }
});
