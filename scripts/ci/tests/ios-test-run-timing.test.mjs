import assert from 'node:assert/strict';
import test from 'node:test';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';
import { summarizeIosTestRunTiming } from '../ios-test-run-timing.mjs';

const context = { sourceSha: 'b'.repeat(40), runId: '500', attempt: '2' };
const date = (minute, second = 0) =>
  `2026-11-03T00:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}Z`;

function report() {
  return {
    report: {
      ...context,
      cohort: 'speech',
      uiPreparationElapsedMs: 9000,
      uiBootstrapElapsedMs: 3000,
      tasks: iosTestCohortTasks('speech').map((task, index) => ({
        profile: task.profile,
        suite: task.suite,
        status: index === 2 ? 'not-run' : index === 1 ? 'failed' : 'passed',
        ...(index < 2 ? { elapsedMs: index === 0 ? 5000 : 6000 } : {}),
      })),
    },
  };
}

function jobs() {
  return [
    {
      name: 'Build / Release',
      labels: ['macos-26'],
      conclusion: 'success',
      created_at: date(0),
      started_at: date(0, 10),
      completed_at: date(0, 50),
      steps: [
        {
          name: 'Run ./.github/actions/ios-test-products-build',
          started_at: date(0, 20),
          completed_at: date(0, 40),
        },
      ],
    },
    {
      name: 'Test / Speech',
      labels: ['macos-26'],
      conclusion: 'failure',
      created_at: date(0, 20),
      started_at: date(1),
      completed_at: date(4),
      steps: [
        {
          name: 'Remove only the owned destination',
          started_at: date(3, 30),
          completed_at: date(3, 35),
        },
        {
          name: 'Disable and verify Spotlight',
          started_at: date(1, 15),
          completed_at: date(1, 16),
        },
        {
          name: 'Provision the pinned Speech runtime',
          started_at: date(1),
          completed_at: date(1, 5),
        },
        {
          name: 'Boot the explicitly owned compatible destination once',
          started_at: date(1, 5),
          completed_at: date(1, 15),
        },
      ],
    },
  ];
}

function summary(
  cases = [
    { identifier: 'Speech/testOne', status: 'passed', durationMs: 1200 },
    { identifier: 'Speech/testTwo', status: 'passed', durationMs: 2300 },
  ],
) {
  return {
    provenance: context,
    selection: { valid: true, selectedCohorts: ['speech'] },
    cases: cases.map((item) => ({ cohort: 'speech', ...item })),
  };
}

test('sums distinct workflow, Mac, queue, build, preparation, XCTest and cleanup time', () => {
  const timing = summarizeIosTestRunTiming({
    run: {
      ...context,
      id: 500,
      run_attempt: 2,
      head_sha: context.sourceSha,
      status: 'completed',
      run_started_at: date(0),
      updated_at: date(5),
    },
    jobs: jobs(),
    summary: summary(),
    reports: [report()],
    selectedCohorts: ['speech'],
    generatedAt: date(5),
  });

  assert.equal(timing.workflowWallMs, 300000);
  assert.equal(timing.elapsedThroughSummaryMs, 300000);
  assert.equal(timing.macWallMs, 230000);
  assert.equal(timing.macOccupancyMs, 220000);
  assert.equal(timing.queueMs, null);
  assert.equal(timing.jobStartDelayMs, 50000);
  assert.match(timing.jobStartDelayNote, /may include queue and dependency wait/);
  assert.equal(timing.dependencyMs, null);
  assert.equal(timing.buildMs, 20000);
  assert.equal(timing.hostBootstrapMs, 1000);
  assert.equal(timing.speechRuntimeProvisioningMs, 5000);
  assert.equal(timing.simulatorPreparationMs, 10000);
  assert.equal(timing.setupPhases[0].name, 'Product build');
  assert.equal(timing.setupPhases[1].name, 'Owned Simulator preparation');
  assert.equal(timing.preparation.uiPreparationMs, 9000);
  assert.equal(timing.preparation.uiBootstrapMs, 3000);
  assert.equal(timing.preparation.speechAssetPreparationMs, 5000);
  assert.equal(timing.testBodyMs, 3500);
  assert.equal(timing.cleanupMs, 5000);
  assert.equal(timing.taskElapsedMs, 11000);
  assert.equal(timing.taskElapsedComplete, true);
  assert.equal(timing.taskElapsedTaskCount, 2);
});

test('missing phase timestamps and duplicate reports stay unknown instead of becoming zero or double cost', () => {
  const pendingJobs = [
    ...jobs().slice(0, 1),
    {
      name: 'Test / Speech',
      labels: ['macos-26'],
      conclusion: 'cancelled',
      created_at: date(0, 20),
    },
  ];
  const partial = summarizeIosTestRunTiming({
    run: {
      ...context,
      id: 500,
      run_attempt: 2,
      head_sha: context.sourceSha,
      status: 'in_progress',
      run_started_at: date(0),
    },
    jobs: pendingJobs,
    summary: summary([
      { identifier: 'Speech/testOne', status: 'passed', durationMs: 1200 },
      { identifier: 'Speech/testTwo', status: 'unexecuted' },
    ]),
    reports: [report()],
    selectedCohorts: ['speech'],
    generatedAt: date(2),
  });
  assert.equal(partial.workflowWallMs, null);
  assert.match(partial.workflowWallReason, /still in progress/);
  assert.equal(partial.elapsedThroughSummaryMs, 120000);
  assert.equal(partial.macWallMs, null);
  assert.equal(partial.macOccupancyMs, null);
  assert.equal(partial.observedMacOccupancyMs, 40000);
  assert.equal(partial.queueMs, null);
  assert.equal(partial.jobStartDelayMs, null);
  assert.equal(partial.testBodyMs, null);
  assert.equal(partial.observedTestBodyMs, 1200);

  const duplicated = summarizeIosTestRunTiming({
    run: {
      ...context,
      id: 500,
      run_attempt: 2,
      head_sha: context.sourceSha,
      status: 'completed',
      run_started_at: date(0),
      updated_at: date(5),
    },
    jobs: jobs(),
    summary: summary(),
    reports: [report(), report()],
    selectedCohorts: ['speech'],
  });
  assert.equal(duplicated.preparation.uiPreparationMs, null);
  assert.deepEqual(duplicated.preparation.missingUiCohorts, ['speech']);
  assert.equal(duplicated.preparation.speechAssetPreparationMs, null);
  assert.equal(duplicated.taskElapsedMs, null);

  const incompleteTaskTiming = summarizeIosTestRunTiming({
    run: {
      ...context,
      id: 500,
      run_attempt: 2,
      head_sha: context.sourceSha,
      status: 'completed',
      run_started_at: date(0),
      updated_at: date(5),
    },
    jobs: jobs(),
    summary: summary(),
    reports: [report()],
    selectedCohorts: ['speech', 'core-integration'],
  });
  assert.equal(incompleteTaskTiming.taskElapsedMs, null);
  assert.equal(incompleteTaskTiming.taskElapsedComplete, false);
  assert.equal(incompleteTaskTiming.observedTaskElapsedMs, 11000);
});

test('missing job and case timestamps remain unknown instead of becoming zero cost', () => {
  const timing = summarizeIosTestRunTiming({
    jobs: [],
    summary: summary([{ identifier: 'Speech/testOne', status: 'unexecuted' }]),
    selectedCohorts: ['speech'],
  });

  assert.equal(timing.macOccupancyMs, null);
  assert.equal(timing.observedMacOccupancyMs, null);
  assert.equal(timing.testBodyMs, null);
  assert.equal(timing.observedTestBodyMs, null);
  assert.equal(timing.taskElapsedMs, null);
  assert.equal(timing.observedTaskElapsedMs, null);
});

test('unknown selected observations keep missing durations in the test-body denominator', () => {
  const timing = summarizeIosTestRunTiming({
    jobs: [],
    summary: summary([
      { identifier: 'Speech/testOne', status: 'passed', durationMs: 1200 },
      { identifier: 'Speech/testTwo', status: 'unknown' },
    ]),
    selectedCohorts: ['speech'],
  });

  assert.equal(timing.testBodyMs, null);
  assert.equal(timing.observedTestBodyMs, 1200);
  assert.equal(timing.testDurationCaseCount, 1);
  assert.equal(timing.selectedCaseCount, 2);
  assert.equal(timing.testBodyComplete, false);
});
