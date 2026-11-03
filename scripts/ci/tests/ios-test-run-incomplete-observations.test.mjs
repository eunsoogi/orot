import assert from 'node:assert/strict';
import test from 'node:test';
import { authenticationCases, caseReport } from '../ios-test-run-summary-cases.mjs';
import { firstFailuresFor } from '../ios-test-run-summary-projections.mjs';

test('failed tasks without case evidence stay unknown while explicit not-run tasks remain unexecuted', () => {
  const tasks = () => [
    { profile: 'core', suite: 'failed', identifiers: ['Target/Class/testUnknown'] },
    { profile: 'core', suite: 'later', identifiers: ['Target/Class/testNotRun'] },
  ];
  const report = {
    tasks: [
      { profile: 'core', suite: 'failed', status: 'failed' },
      { profile: 'core', suite: 'later', status: 'not-run' },
    ],
  };
  const context = {
    runId: '88',
    attempt: '1',
    runUrl: 'https://github.com/example/repo/actions/runs/88/attempts/1',
  };
  const result = caseReport(
    { cohort: 'core', configuration: 'Debug' },
    report,
    'ordinaryIphone',
    context,
    '.',
    {},
    tasks,
  );
  assert.deepEqual(
    result.cases.map((item) => item.status),
    ['unknown', 'unexecuted'],
  );
  const failures = firstFailuresFor(new Map([['core', [report]]]), context, '.', tasks);
  assert.equal(failures[0].expectedRawArtifact, 'ios-cohort-core-88-1');
  assert.equal(failures[0].sourceArtifactsUrl, context.runUrl);
});

test('authentication without a receipt does not invent case execution', () => {
  const inventory = () => ['Target/Auth/testCase'];
  const cases = (report, result) =>
    authenticationCases(report, true, {}, '.', { authentication: { result } }, inventory);
  assert.equal(cases(undefined, 'failure')[0].status, 'unknown');
  assert.equal(cases(undefined, 'skipped')[0].status, 'skipped');
  assert.equal(
    cases(
      { observations: [{ identifier: 'Target/Auth/testCase', result: 'Failed' }] },
      'cancelled',
    )[0].status,
    'failed',
  );
});
