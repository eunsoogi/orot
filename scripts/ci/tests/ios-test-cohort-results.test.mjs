import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';
import { verifyIosTestCohortResults } from '../ios-test-cohort-results.mjs';

const context = { sourceSha: 'a'.repeat(40), runId: '101', attempt: '1' };
function report(cohort) {
  return {
    schemaVersion: 1,
    cohort,
    sample: 'first',
    passed: true,
    ...context,
    tasks: iosTestCohortTasks(cohort).map((task) => ({
      profile: task.profile,
      suite: task.suite,
      status: 'passed',
      observations: task.identifiers.map((identifier) => ({
        identifier,
        result: 'Passed',
        duration: 1,
      })),
    })),
  };
}

test('Linux aggregation retains all first-attempt observations from each compatible cohort', () => {
  for (const [cohort, count] of [
    ['release', 50],
    ['speech', 11],
    ['debug', 17],
  ])
    assert.equal(verifyIosTestCohortResults(report(cohort), cohort, context).length, count);
});

test('missing, failed, cancelled-like, focused-only, repeated and stale receipts cannot produce a complete gate', () => {
  for (const mutate of [
    (value) => {
      value.passed = false;
    },
    (value) => {
      value.sourceSha = 'b'.repeat(40);
    },
    (value) => {
      value.runId = '100';
    },
    (value) => {
      value.attempt = '2';
    },
    (value) => {
      value.tasks.pop();
    },
    (value) => {
      value.tasks[0].status = 'cancelled';
    },
    (value) => {
      value.tasks[0].observations.pop();
    },
    (value) => {
      value.tasks[1] = value.tasks[0];
    },
    (value) => {
      value.tasks[0].observations[0].result = 'Skipped';
    },
  ]) {
    const value = report('release');
    mutate(value);
    assert.throws(() => verifyIosTestCohortResults(value, 'release', context));
  }
});

test('a first Speech result cannot certify another fresh sample or an unidentified sample', () => {
  const value = { ...report('speech'), sample: 'first' };
  assert.throws(() =>
    verifyIosTestCohortResults(value, 'speech', { ...context, sample: 'second' }),
  );
  const missing = report('speech');
  delete missing.sample;
  assert.throws(() =>
    verifyIosTestCohortResults(missing, 'speech', { ...context, sample: 'first' }),
  );
});

test('each fresh sample requires its own complete observations and rejects unknown identities', () => {
  for (const sample of ['first', 'second', 'third']) {
    const value = { ...report('speech'), sample };
    assert.equal(verifyIosTestCohortResults(value, 'speech', { ...context, sample }).length, 11);
    value.tasks[2].status = 'failed';
    assert.throws(() => verifyIosTestCohortResults(value, 'speech', { ...context, sample }));
  }
  for (const sample of ['retry', '', 'fourth'])
    assert.throws(() =>
      verifyIosTestCohortResults(report('speech'), 'speech', { ...context, sample }),
    );
  assert.throws(() =>
    verifyIosTestCohortResults(report('debug'), 'debug', { ...context, sample: 'second' }),
  );
});

test('CLI rejects a reused first result and emits the explicit identity for a complete later sample', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-cohort-sample-'));
  try {
    const input = join(directory, 'results.json');
    const output = join(directory, 'verified.json');
    const env = {
      ...process.env,
      GITHUB_SHA: context.sourceSha,
      GITHUB_RUN_ID: context.runId,
      GITHUB_RUN_ATTEMPT: context.attempt,
    };
    const args = ['scripts/ci/ios-test-cohort-results.mjs', 'speech', input, output, 'second'];
    writeFileSync(input, JSON.stringify(report('speech')));
    const rejected = spawnSync(process.execPath, args, { env, encoding: 'utf8' });
    assert.equal(rejected.status, 1);
    assert.equal(existsSync(output), false);
    writeFileSync(input, JSON.stringify({ ...report('speech'), sample: 'second' }));
    const accepted = spawnSync(process.execPath, args, { env, encoding: 'utf8' });
    assert.equal(accepted.status, 0, accepted.stderr);
    const value = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(value.sample, 'second');
    assert.equal(value.observations.length, 11);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
