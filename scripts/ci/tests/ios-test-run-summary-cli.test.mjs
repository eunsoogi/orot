import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';

const context = { sourceSha: 'c'.repeat(40), runId: '88', attempt: '1' };
const cohort = 'core-integration';

function prepare(t, malformed = false, taskFailure = false) {
  const root = mkdtempSync(join(tmpdir(), 'orot-ios-summary-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const reportDirectory = join(root, 'reports');
  const artifact = join(
    reportDirectory,
    `ios-cohort-report-${cohort}-${context.runId}-${context.attempt}`,
  );
  mkdirSync(artifact, { recursive: true });
  const observations = iosTestCohortTasks(cohort).flatMap((task) =>
    task.identifiers.map((identifier) => ({ identifier, result: 'Passed', duration: 1 })),
  );
  writeFileSync(
    join(artifact, 'results.json'),
    malformed
      ? '{invalid json'
      : JSON.stringify({
          schemaVersion: 2,
          ...context,
          cohort,
          passed: !taskFailure,
          tasks: iosTestCohortTasks(cohort).map((task, index) => ({
            profile: task.profile,
            suite: task.suite,
            status: taskFailure && index === 0 ? 'failed' : 'passed',
            elapsedMs: 2500,
            ...(taskFailure && index === 0
              ? { error: 'Xcode exited 65', observations: [] }
              : {
                  observations: task.identifiers.map((identifier) =>
                    observations.find((observation) => observation.identifier === identifier),
                  ),
                }),
          })),
        }),
  );
  const outputPath = join(root, 'ios-test-run-summary.json');
  const stepSummary = join(root, 'step-summary.md');
  const env = { ...process.env };
  delete env.GITHUB_TOKEN;
  Object.assign(env, {
    GITHUB_SHA: context.sourceSha,
    GITHUB_RUN_ID: context.runId,
    GITHUB_RUN_ATTEMPT: context.attempt,
    GITHUB_REPOSITORY: 'eunsoogi/orot',
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_WORKSPACE: process.cwd(),
    GITHUB_STEP_SUMMARY: stepSummary,
    OROT_IOS_TEST_COHORTS: JSON.stringify([cohort]),
    OROT_IOS_EXECUTION_RESULTS: '{}',
    OROT_IOS_OAUTH_REQUIRED: 'false',
    OROT_IOS_VALIDATION_TIER: 'pr',
  });
  const execution = spawnSync(
    process.execPath,
    [
      'scripts/ci/ios-test-run-summary-cli.mjs',
      reportDirectory,
      join(root, 'authentication'),
      outputPath,
    ],
    { encoding: 'utf8', env },
  );
  return { root, outputPath, stepSummary, execution };
}

test('CLI writes a run-bound JSON artifact and GitHub step summary without changing result acceptance', (t) => {
  const { outputPath, stepSummary, execution } = prepare(t);
  assert.equal(execution.status, 0, execution.stderr);
  assert.match(execution.stdout, /IOS_TEST_RUN_SUMMARY run=88 attempt=1/);
  assert.match(execution.stdout, /failures=0 taskFailures=0/);
  assert.equal(existsSync(outputPath), true);
  const summary = JSON.parse(readFileSync(outputPath, 'utf8'));
  assert.equal(
    summary.provenance.runUrl,
    'https://github.com/eunsoogi/orot/actions/runs/88/attempts/1',
  );
  assert.equal(
    summary.coverage.ordinaryIphone.counts.passed,
    iosTestCohortTasks(cohort).flatMap((task) => task.identifiers).length,
  );
  assert.equal(summary.timing.available, false);
  assert.equal(summary.coverage.authentication.jobStatus, 'not-selected');
  assert.equal(summary.coverage.production.status, 'not-selected');
  assert.match(readFileSync(stepSummary, 'utf8'), /## iOS test run report/);
  assert.match(readFileSync(stepSummary, 'utf8'), /Opt-in Duo/);
});

test('CLI reports malformed artifacts while preserving the selected cases as incomplete', (t) => {
  const { outputPath, stepSummary, execution } = prepare(t, true);
  assert.equal(execution.status, 0, execution.stderr);
  const summary = JSON.parse(readFileSync(outputPath, 'utf8'));
  assert.equal(summary.reportReadErrors.length, 1);
  assert.equal(summary.coverage.ordinaryIphone.counts.passed, 0);
  assert.equal(
    summary.coverage.ordinaryIphone.counts.unexecuted,
    iosTestCohortTasks(cohort).flatMap((task) => task.identifiers).length,
  );
  assert.match(readFileSync(stepSummary, 'utf8'), /Artifact diagnostics/);
  assert.match(readFileSync(stepSummary, 'utf8'), /Could not read/);
});

test('CLI distinguishes failed tasks from failed case observations', (t) => {
  const { outputPath, execution } = prepare(t, false, true);
  assert.equal(execution.status, 0, execution.stderr);
  assert.match(execution.stdout, /failures=0 taskFailures=1/);
  const summary = JSON.parse(readFileSync(outputPath, 'utf8'));
  assert.equal(summary.counts.failed, 0);
  assert.equal(summary.firstFailures.length, 1);
});
