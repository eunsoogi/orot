import { verifyIosObservationList } from './ios-test-results.mjs';

/** Preserve the first failure and stop scheduling expensive work. Unexecuted tasks remain explicit and cannot satisfy completeness. */
export async function executeIosTestCohortTasks(tasks, execute) {
  if (
    !Array.isArray(tasks) ||
    !tasks.length ||
    new Set(tasks.map((task) => task.profile + '/' + task.suite)).size !== tasks.length
  )
    throw new Error('Cohort execution requires a nonempty, unique task plan');
  const results = [];
  const cohortStarted = Date.now();
  let blockedBy;
  let firstFailureElapsedMs = null;
  for (const task of tasks) {
    if (blockedBy) {
      results.push({ profile: task.profile, suite: task.suite, status: 'not-run', blockedBy });
      continue;
    }
    const started = Date.now();
    try {
      const observations = verifyIosObservationList(await execute(task), task.identifiers);
      results.push({
        profile: task.profile,
        suite: task.suite,
        status: 'passed',
        observations,
        elapsedMs: Date.now() - started,
      });
    } catch (error) {
      blockedBy = task.profile + '/' + task.suite;
      firstFailureElapsedMs = Date.now() - cohortStarted;
      results.push({
        profile: task.profile,
        suite: task.suite,
        status: 'failed',
        error: String(error),
        elapsedMs: Date.now() - started,
      });
    }
  }
  return {
    passed: results.every((result) => result.status === 'passed'),
    firstFailureElapsedMs,
    tasks: results,
  };
}
