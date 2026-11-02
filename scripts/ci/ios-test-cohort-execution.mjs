import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyIosObservationList } from './ios-test-results.mjs';

/** Preserve raw observations from a failed fixture subprocess without replacing its primary error. */
export function executeIosFixtureCohortTask(resultsDirectory, execute) {
  let executionError;
  try {
    execute();
  } catch (error) {
    executionError = error;
  }

  let receipt;
  try {
    receipt = JSON.parse(readFileSync(join(resultsDirectory, 'results.json'), 'utf8'));
  } catch (receiptError) {
    if (executionError) throw executionError;
    throw receiptError;
  }

  if (executionError) {
    const observations = Array.isArray(receipt.rawObservations)
      ? receipt.rawObservations
      : receipt.observations;
    if (Array.isArray(observations)) executionError.observations = observations;
    throw executionError;
  }
  return receipt.observations;
}

/** Preserve the first failure and its observations, then stop costly work without satisfying completeness. */
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
    let observations;
    try {
      observations = await execute(task);
      const verified = verifyIosObservationList(observations, task.identifiers);
      results.push({
        profile: task.profile,
        suite: task.suite,
        status: 'passed',
        observations: verified,
        elapsedMs: Date.now() - started,
      });
    } catch (error) {
      blockedBy = task.profile + '/' + task.suite;
      firstFailureElapsedMs = Date.now() - cohortStarted;
      const observed = Array.isArray(error?.observations)
        ? error.observations
        : Array.isArray(observations)
          ? observations
          : undefined;
      const firstFailure = observed?.find((item) =>
        ['Failed', 'Expected Failure'].includes(item.result),
      );
      results.push({
        profile: task.profile,
        suite: task.suite,
        status: 'failed',
        error: String(error),
        ...(observed ? { observations: observed } : {}),
        ...(firstFailure ? { firstFailure } : {}),
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
