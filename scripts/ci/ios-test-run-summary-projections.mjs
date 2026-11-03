import { iosTestCohortTasks } from './ios-test-cohorts.mjs';
import { countStatuses, makeCase } from './ios-test-run-summary-cases.mjs';

/** Keep planned selection independent from each case's execution outcome. */
export function summarizedGroup(cases, { selected, selectionReason } = {}) {
  return {
    selected,
    ...(selectionReason ? { selectionReason } : {}),
    expectedCount: cases.length,
    selectedCount: selected ? cases.filter((item) => item.status !== 'not-selected').length : 0,
    counts: countStatuses(cases),
  };
}

/** Link first failures only when they belong to a unique current-attempt cohort report. */
export function firstFailuresFor(reportsByCohort, context, root, tasks = iosTestCohortTasks) {
  const failures = [];
  for (const [cohort, reports] of reportsByCohort) {
    // Duplicate artifacts cannot identify which report owns the first failure.
    if (reports.length !== 1) continue;
    const report = reports[0];
    for (const task of report.tasks ?? []) {
      if (task.status !== 'failed') continue;
      const observation = task.firstFailure;
      const category = cohort === 'speech' ? 'speech' : 'ordinaryIphone';
      const expectedTask = tasks(cohort).find(
        (item) => item.profile === task.profile && item.suite === task.suite,
      );
      const expected = new Set(expectedTask?.identifiers ?? []);
      const failureCase =
        typeof observation?.identifier === 'string' && expected.has(observation.identifier)
          ? makeCase(category, cohort, observation.identifier, 'failed', context, root, observation)
          : undefined;
      failures.push({
        cohort,
        profile: task.profile,
        suite: task.suite,
        ...(context?.runUrl ? { runUrl: context.runUrl } : {}),
        ...(Number.isFinite(report.firstFailureElapsedMs)
          ? { elapsedMs: report.firstFailureElapsedMs }
          : {}),
        ...(failureCase ? { observation: failureCase } : {}),
        ...(typeof task.error === 'string' ? { taskError: task.error } : {}),
      });
    }
  }
  return failures;
}
