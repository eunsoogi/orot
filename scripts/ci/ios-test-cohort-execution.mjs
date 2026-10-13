import { verifyIosObservationList } from './ios-test-results.mjs';

/** Independent tasks continue after a recorded failure so coverage remains observable; the cohort can only pass when every first attempt passes. */
export async function executeIosTestCohortTasks(tasks, execute) {
  if (
    !Array.isArray(tasks) ||
    !tasks.length ||
    new Set(tasks.map((task) => task.profile + '/' + task.suite)).size !== tasks.length
  )
    throw new Error('Cohort execution requires a nonempty, unique task plan');
  const results = [];
  for (const task of tasks) {
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
      results.push({
        profile: task.profile,
        suite: task.suite,
        status: 'failed',
        error: String(error),
        elapsedMs: Date.now() - started,
      });
    }
  }
  return { passed: results.every((result) => result.status === 'passed'), tasks: results };
}
