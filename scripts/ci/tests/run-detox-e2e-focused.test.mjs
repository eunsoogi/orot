import assert from 'node:assert/strict';
import test from 'node:test';
import { runRunner } from './run-detox-e2e-test-support.mjs';

test('passes one focused Release test to Detox without nesting the full runner command', () => {
  const { result, calls } = runRunner({
    profile: 'release',
    openaiSimulatorId: '',
    releaseShard: 'release-e2e-data.test.js',
    releaseSharding: 'true',
    focusedScenarioName: 'creates, edits, and cancels an appointment',
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(calls.length, 1);
  assert.equal((calls[0].match(/detox test/g) || []).length, 1);
  assert.match(calls[0], /--configuration ios\.sim\.release/);
  assert.match(calls[0], /--runTestsByPath e2e\/release-e2e-data\.test\.js/);
  assert.match(calls[0], /--testNamePattern creates, edits, and cancels an appointment/);
});
