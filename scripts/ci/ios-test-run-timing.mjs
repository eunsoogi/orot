import { iosTestCohortTasks, iosTestTaskNeedsUiPreparation } from './ios-test-cohorts.mjs';
import { IOS_TEST_COHORT_NAMES } from './ios-test-execution-plan.mjs';
import { exactReport } from './ios-test-run-summary-cases.mjs';
import { selectedSummaryCases } from './ios-test-run-selected-cases.mjs';
import { duration, instant, isMacJob } from './ios-test-run-time-utils.mjs';

/** Keep a phase total unknown unless every matching workflow step has both timestamps. */
function stepDurations(jobs, pattern) {
  const matches = jobs.flatMap((job) =>
    (job.steps ?? [])
      .filter((step) => pattern.test(step.name ?? ''))
      .map((step) => ({
        job: job.name,
        name: step.name,
        durationMs: duration(step.started_at, step.completed_at),
      })),
  );
  const complete = matches.length > 0 && matches.every((item) => Number.isFinite(item.durationMs));
  return {
    valueMs: complete ? matches.reduce((sum, item) => sum + item.durationMs, 0) : null,
    matches,
  };
}

function uniqueSelectedReports(reports, summary, selectedCohorts, names) {
  const grouped = new Map();
  if (summary?.selection?.valid === false) return [];
  for (const entry of reports) {
    const report = entry.report;
    if (
      !exactReport(report, summary?.provenance) ||
      !names.includes(report.cohort) ||
      !selectedCohorts.includes(report.cohort)
    )
      continue;
    const bucket = grouped.get(report.cohort) ?? [];
    bucket.push(report);
    grouped.set(report.cohort, bucket);
  }
  // Duplicate artifacts make their preparation and task durations ambiguous, so do not sum either one.
  return [...grouped.values()]
    .filter((bucket) => bucket.length === 1)
    .map(([report]) => ({ report }));
}

/** Sum preparation receipts only when every selected UI cohort reports that phase. */
function preparationDurations(reports, selectedCohorts, tasks, needsPreparation) {
  const byCohort = new Map(reports.map((entry) => [entry.report.cohort, entry.report]));
  const needsUi = selectedCohorts.filter((cohort) => tasks(cohort).some(needsPreparation));
  const missingUi = needsUi.filter(
    (cohort) => !Number.isFinite(byCohort.get(cohort)?.uiPreparationElapsedMs),
  );
  const missingBootstrap = needsUi.filter(
    (cohort) => !Number.isFinite(byCohort.get(cohort)?.uiBootstrapElapsedMs),
  );
  const uiValues = needsUi
    .map((cohort) => byCohort.get(cohort)?.uiPreparationElapsedMs)
    .filter(Number.isFinite);
  const bootstrapValues = needsUi
    .map((cohort) => byCohort.get(cohort)?.uiBootstrapElapsedMs)
    .filter(Number.isFinite);
  const speech = byCohort.get('speech');
  const speechPreparation = speech?.tasks?.find((task) => task.suite === 'preparation')?.elapsedMs;
  return {
    uiPreparationMs: missingUi.length ? null : uiValues.reduce((sum, value) => sum + value, 0),
    uiBootstrapMs: missingBootstrap.length
      ? null
      : bootstrapValues.reduce((sum, value) => sum + value, 0),
    speechAssetPreparationMs: Number.isFinite(speechPreparation) ? speechPreparation : null,
    missingUiCohorts: missingUi,
    missingBootstrapCohorts: missingBootstrap,
  };
}

/** Sum only exact selected task receipts, treating explicit not-run tasks as zero execution time. */
function taskElapsedSummary(reports, selectedCohorts, tasks) {
  const byCohort = new Map(reports.map((entry) => [entry.report.cohort, entry.report]));
  const expectedTaskCount = selectedCohorts.reduce(
    (count, cohort) => count + tasks(cohort).length,
    0,
  );
  const observedDurations = [];
  let complete = expectedTaskCount > 0 && byCohort.size === selectedCohorts.length;

  for (const cohort of selectedCohorts) {
    const report = byCohort.get(cohort);
    const expectedTasks = tasks(cohort);
    const actualTasks = Array.isArray(report?.tasks) ? report.tasks : [];
    if (!report || actualTasks.length !== expectedTasks.length) complete = false;
    for (const task of expectedTasks) {
      const matches = actualTasks.filter(
        (item) => item.profile === task.profile && item.suite === task.suite,
      );
      if (matches.length !== 1) {
        complete = false;
        continue;
      }
      const actual = matches[0];
      if (Number.isFinite(actual.elapsedMs)) observedDurations.push(actual.elapsedMs);
      if (actual.status === 'not-run' && !Number.isFinite(actual.elapsedMs)) continue;
      if (!['passed', 'failed'].includes(actual.status) || !Number.isFinite(actual.elapsedMs))
        complete = false;
    }
  }

  const observedMs = observedDurations.reduce((sum, value) => sum + value, 0);
  return {
    taskElapsedMs: complete ? observedMs : null,
    observedTaskElapsedMs: observedDurations.length ? observedMs : null,
    taskElapsedTaskCount: observedDurations.length,
    expectedTaskElapsedTaskCount: expectedTaskCount,
    taskElapsedComplete: complete,
  };
}

/** Derive time only from exact-attempt timestamps and unique reports; missing phases stay unknown. */
export function summarizeIosTestRunTiming({
  run,
  jobs = [],
  summary,
  reports = [],
  selectedCohorts = [],
  generatedAt = new Date().toISOString(),
  inventory = {
    names: IOS_TEST_COHORT_NAMES,
    tasks: iosTestCohortTasks,
    needsUi: iosTestTaskNeedsUiPreparation,
  },
}) {
  const macJobs = jobs.filter((job) => isMacJob(job) && job.conclusion !== 'skipped');
  const completedMac = macJobs.map((job) => ({
    job,
    durationMs: duration(job.started_at, job.completed_at),
  }));
  const pendingMac = macJobs.filter(
    (job) => !Number.isFinite(duration(job.started_at, job.completed_at)),
  );
  const occupancyValues = completedMac.map((item) => item.durationMs).filter(Number.isFinite);
  const occupancySum = occupancyValues.reduce((sum, value) => sum + value, 0);
  const macStartTimes = macJobs.map((job) => instant(job.started_at)).filter(Number.isFinite);
  const macEndTimes = macJobs.map((job) => instant(job.completed_at)).filter(Number.isFinite);
  const jobStartDelays = macJobs.map((job) => duration(job.created_at, job.started_at));
  const jobStartDelayComplete =
    macJobs.length > 0 &&
    macJobs.every(
      (job) =>
        Number.isFinite(duration(job.created_at, job.started_at)) || job.conclusion === 'skipped',
    );
  const build = stepDurations(
    macJobs,
    /(?:^Run \.\/\.github\/actions\/ios-(?:test-products-build|production-validation|oauth-build)$|^Compile the package tests|^Build the OAuth Simulator harness)/i,
  );
  const hostBootstrap = stepDurations(macJobs, /Disable and verify Spotlight/i);
  const speechRuntime = stepDurations(macJobs, /Provision the pinned Speech runtime/i);
  const simulatorPreparation = stepDurations(
    macJobs,
    /Boot the explicitly owned compatible destination once/i,
  );
  const cleanup = stepDurations(macJobs, /cleanup|tear down|remove only the owned destination/i);
  const exactReports = uniqueSelectedReports(reports, summary, selectedCohorts, inventory.names);
  const preparation = preparationDurations(
    exactReports,
    selectedCohorts,
    inventory.tasks,
    inventory.needsUi,
  );
  const taskElapsed = taskElapsedSummary(exactReports, selectedCohorts, inventory.tasks);
  const selectedCases = selectedSummaryCases(summary, selectedCohorts);
  const durationCases = selectedCases.filter(
    (item) =>
      Number.isFinite(item.durationMs) && item.status !== 'duplicate' && item.status !== 'stale',
  );
  // Creation time can include queueing, so it cannot stand in for a missing run start.
  const workflowStart = run?.run_started_at;
  const workflowEnd = run?.status === 'completed' ? run.updated_at : generatedAt;
  const elapsedAtReport = duration(workflowStart, workflowEnd);
  const workflowWall =
    run?.status === 'completed' ? duration(run.run_started_at, run.updated_at) : undefined;
  const testBody = durationCases.reduce((sum, item) => sum + item.durationMs, 0);
  const testBodyComplete =
    selectedCases.length > 0 && durationCases.length === selectedCases.length;
  const setupPhases = [
    { name: 'Product build', durationMs: build.valueMs },
    { name: 'Host bootstrap', durationMs: hostBootstrap.valueMs },
    { name: 'Speech runtime provisioning', durationMs: speechRuntime.valueMs },
    { name: 'Owned Simulator preparation', durationMs: simulatorPreparation.valueMs },
    { name: 'UI preparation', durationMs: preparation.uiPreparationMs },
    { name: 'UI bootstrap', durationMs: preparation.uiBootstrapMs },
    { name: 'Speech asset preparation', durationMs: preparation.speechAssetPreparationMs },
  ]
    .filter((phase) => Number.isFinite(phase.durationMs))
    .sort((left, right) => right.durationMs - left.durationMs);
  return {
    source: { runId: run?.id, attempt: run?.run_attempt, headSha: run?.head_sha },
    workflowWallMs: workflowWall ?? null,
    elapsedThroughSummaryMs: elapsedAtReport ?? null,
    workflowWallReason:
      workflowWall === undefined
        ? !Number.isFinite(instant(run?.run_started_at))
          ? 'Workflow start timestamp is unavailable'
          : run?.status === 'completed'
            ? 'Complete run timestamps are unavailable'
            : 'The workflow is still in progress while its summary is written'
        : undefined,
    macWallMs:
      pendingMac.length || !macStartTimes.length || !macEndTimes.length
        ? null
        : Math.max(...macEndTimes) - Math.min(...macStartTimes),
    macOccupancyMs: pendingMac.length || !macJobs.length ? null : occupancySum,
    observedMacOccupancyMs: occupancyValues.length ? occupancySum : null,
    macJobCount: macJobs.length,
    pendingMacJobs: pendingMac.map((job) => job.name),
    queueMs: null,
    jobStartDelayMs: jobStartDelayComplete
      ? jobStartDelays.filter(Number.isFinite).reduce((sum, value) => sum + value, 0)
      : null,
    jobStartDelayNote:
      'Job created-to-start time may include queue and dependency wait; the API does not expose when a job became runnable.',
    dependencyMs: null,
    dependencyTimingNote:
      'Queue-only and dependency-only durations remain unknown because Actions does not expose dependency-ready timestamps.',
    buildMs: build.valueMs,
    buildSteps: build.matches,
    hostBootstrapMs: hostBootstrap.valueMs,
    speechRuntimeProvisioningMs: speechRuntime.valueMs,
    simulatorPreparationMs: simulatorPreparation.valueMs,
    setupPhases,
    preparation,
    testBodyMs: testBodyComplete ? testBody : null,
    observedTestBodyMs: durationCases.length ? testBody : null,
    testDurationCaseCount: durationCases.length,
    selectedCaseCount: selectedCases.length,
    testBodyComplete,
    ...taskElapsed,
    cleanupMs: cleanup.valueMs,
    cleanupSteps: cleanup.matches,
  };
}

export { readIosWorkflowTiming } from './ios-test-run-actions-api.mjs';
