import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import test from 'node:test';
import { speechJourneyTests } from '../ios-test-config.mjs';
import { fixtureIsolationTests } from '../fixture-isolation-test-phases.mjs';
import { recordingPersistenceTests } from '../recording-persistence-test-phases.mjs';
import { statePersistenceTests } from '../state-persistence-test-phases.mjs';
import { fixture } from './fixtures/ios-test-runner.mjs';

test('new-process Speech and fixture phases reject bare cases, wrong phase and missing captured state before Xcode', () => {
  for (const [profile, identifiers, phaseKey, first, second, token, baseline] of [
    [
      'core',
      statePersistenceTests,
      'OROT_IOS_STATE_PHASE',
      'seed',
      'resume',
      {
        TEST_RUNNER_OROT_STATE_FIXTURE: 'test-persistence-11111111-2222-4333-8444-555555555555',
        TEST_RUNNER_OROT_STATE_MEMORY_FIXTURE: 'test-memory-11111111-2222-4333-8444-666666666666',
      },
      'TEST_RUNNER_OROT_STATE_PREVIOUS_PIDS',
    ],
    [
      'core',
      recordingPersistenceTests,
      'OROT_IOS_RECORDING_PHASE',
      'seed',
      'read',
      {},
      'TEST_RUNNER_OROT_RECORDING_BASELINE',
    ],
    [
      'speech',
      speechJourneyTests,
      'OROT_IOS_SPEECH_PHASE',
      'ui',
      'readback',
      {},
      'TEST_RUNNER_OROT_SPEECH_BASELINE',
    ],
    [
      'core',
      fixtureIsolationTests,
      'OROT_IOS_FIXTURE_PHASE',
      'seed',
      'verify',
      { TEST_RUNNER_OROT_FIXTURE_TOKEN: '11111111-2222-4333-8444-555555555555' },
      'TEST_RUNNER_OROT_FIXTURE_BASELINE',
    ],
  ]) {
    for (const [selected, environment] of [
      [[identifiers[0]], {}],
      [[identifiers[1]], {}],
      [identifiers, { [phaseKey]: first, ...token }],
      [[identifiers[0]], { [phaseKey]: second, ...token }],
      [[identifiers[1]], { [phaseKey]: second, ...token }],
    ]) {
      const value = fixture(0, profile, 'all', selected, environment);
      try {
        assert.notEqual(value.outcome.status, 0);
        assert.match(value.outcome.stderr, /host-orchestrated/);
        assert.ok(!value.calls.some((call) => call.name === 'xcodebuild'));
      } finally {
        rmSync(value.directory, { recursive: true, force: true });
      }
    }
    for (const [identifier, environment] of [
      [identifiers[0], { [phaseKey]: first, ...token }],
      [identifiers[1], { [phaseKey]: second, ...token, [baseline]: '{"captured":"fixture"}' }],
    ]) {
      const value = fixture(65, profile, 'all', [identifier], environment);
      try {
        assert.equal(value.outcome.status, 65);
        assert.equal(value.calls.filter((call) => call.name === 'xcodebuild').length, 1);
      } finally {
        rmSync(value.directory, { recursive: true, force: true });
      }
    }
  }
});
