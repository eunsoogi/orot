import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import test from 'node:test';
import { fixture } from './fixtures/ios-test-runner.mjs';
import {
  encounterReviewPersistenceTests as identifiers,
  encounterReviewPersistencePhases as phases,
} from '../encounter-review-persistence-test-phases.mjs';
import { selectFocusedIosTests } from '../ios-focused-selection.mjs';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';

function environment(index) {
  return {
    OROT_IOS_ENCOUNTER_REVIEW_PHASE: phases[index],
    TEST_RUNNER_OROT_ENCOUNTER_REVIEW_RUN_ID: '11111111-2222-4333-8444-555555555555',
    TEST_RUNNER_OROT_ENCOUNTER_REVIEW_FIXTURE:
      'test-persistence-11111111-2222-4333-8444-666666666666',
    TEST_RUNNER_OROT_ENCOUNTER_REVIEW_PREVIOUS_PIDS: JSON.stringify(
      Array.from({ length: index }, (_, i) => i + 10),
    ),
  };
}

test('registered driver phases reach exactly one native invocation and preserve first failure', () => {
  for (const [index, identifier] of identifiers.entries()) {
    const value = fixture(
      65,
      'core',
      'encounter-review-persistence',
      [identifier],
      environment(index),
    );
    try {
      assert.equal(value.outcome.status, 65, value.outcome.stderr);
      const calls = value.calls.filter((call) => call.name === 'xcodebuild');
      assert.equal(calls.length, 1);
      assert.deepEqual(
        calls[0].args.filter((arg) => arg.startsWith('-only-testing:')),
        ['-only-testing:' + identifier],
      );
    } finally {
      rmSync(value.directory, { recursive: true, force: true });
    }
  }
});

test('bare, foreign, repeated and partial phase selections fail before native invocation', () => {
  const valid = environment(2);
  for (const [selected, env] of [
    [[identifiers[0]], {}],
    [identifiers, valid],
    [[identifiers[0]], valid],
    [[identifiers[2]], { ...valid, TEST_RUNNER_OROT_ENCOUNTER_REVIEW_PREVIOUS_PIDS: '[10,10]' }],
    [[identifiers[2]], { ...valid, TEST_RUNNER_OROT_ENCOUNTER_REVIEW_RUN_ID: '' }],
  ]) {
    const value = fixture(0, 'core', 'encounter-review-persistence', selected, env);
    try {
      assert.notEqual(value.outcome.status, 0);
      assert.ok(!value.calls.some((call) => call.name === 'xcodebuild'));
    } finally {
      rmSync(value.directory, { recursive: true, force: true });
    }
  }
});

test('review persistence has an independent complete cohort and only whole-group focused selection', () => {
  const [task] = iosTestCohortTasks('encounter-review-persistence');
  assert.equal(task.mode, 'encounter-review-persistence');
  assert.deepEqual(task.identifiers, identifiers);
  const selection = selectFocusedIosTests(
    'ios/core',
    'scripts/ci/encounter-review-persistence-test-phases.mjs',
    'group/encounter-review-persistence',
  );
  assert.deepEqual(selection.identifiers, identifiers);
  assert.equal(selection.prepareUi, false);
  for (const identifier of identifiers)
    assert.throws(() =>
      selectFocusedIosTests(
        'ios/core',
        'apps/mobile/ios/OrotIntegrationTests/EncounterReviewPersistenceIntegrationTests.swift',
        identifier,
      ),
    );
});
