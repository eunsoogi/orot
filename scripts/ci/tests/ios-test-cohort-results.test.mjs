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
    schemaVersion: 2,
    cohort,
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
    ['release', 63],
    ['release-core', 46],
    ['release-ui', 17],
    ['speech', 9],
    ['debug', 24],
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

test('one complete Speech result cannot certify a different CI run or attempt', () => {
  for (const changedContext of [
    { ...context, runId: '102' },
    { ...context, attempt: '2' },
  ])
    assert.throws(() => verifyIosTestCohortResults(report('speech'), 'speech', changedContext));
});

test('a candidate requires its own observations and rejects historical intra-run sample reports', () => {
  for (const attempt of ['1', '2', '3']) {
    const value = { ...report('speech'), attempt };
    assert.equal(verifyIosTestCohortResults(value, 'speech', { ...context, attempt }).length, 9);
    value.tasks[2].status = 'failed';
    assert.throws(() => verifyIosTestCohortResults(value, 'speech', { ...context, attempt }));
  }
  for (const sample of ['first', 'second', 'third'])
    assert.throws(() =>
      verifyIosTestCohortResults(
        { ...report('speech'), schemaVersion: 1, sample },
        'speech',
        context,
      ),
    );
});

test('CLI rejects a previous attempt and preserves the identity of its own complete execution', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-cohort-execution-'));
  try {
    const input = join(directory, 'results.json');
    const output = join(directory, 'verified.json');
    const env = {
      ...process.env,
      GITHUB_SHA: context.sourceSha,
      GITHUB_RUN_ID: context.runId,
      GITHUB_RUN_ATTEMPT: '2',
    };
    const args = ['scripts/ci/ios-test-cohort-results.mjs', 'speech', input, output];
    writeFileSync(input, JSON.stringify(report('speech')));
    const rejected = spawnSync(process.execPath, args, { env, encoding: 'utf8' });
    assert.equal(rejected.status, 1);
    assert.equal(existsSync(output), false);
    writeFileSync(input, JSON.stringify({ ...report('speech'), attempt: '2' }));
    const accepted = spawnSync(process.execPath, args, { env, encoding: 'utf8' });
    assert.equal(accepted.status, 0, accepted.stderr);
    const value = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(value.runId, context.runId);
    assert.equal(value.attempt, '2');
    assert.equal(value.sample, undefined);
    assert.equal(value.observations.length, 9);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
