import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { iosTestCohortTasks, iosTestCohortSample } from './ios-test-cohorts.mjs';
import { verifyIosObservationList } from './ios-test-results.mjs';

/** Linux aggregation requires every planned first attempt at the current run/head. A passing subset or stale receipt cannot satisfy completeness. */
export function verifyIosTestCohortResults(report, cohort, context) {
  const expected = iosTestCohortTasks(cohort);
  const sample = iosTestCohortSample(cohort, context.sample);
  if (
    report.schemaVersion !== 1 ||
    report.cohort !== cohort ||
    report.sample !== sample ||
    report.passed !== true ||
    report.sourceSha !== context.sourceSha ||
    report.runId !== context.runId ||
    report.attempt !== context.attempt ||
    !Array.isArray(report.tasks) ||
    report.tasks.length !== expected.length
  )
    throw new Error('Missing, failed or stale integration cohort results');
  const actualKeys = report.tasks.map((task) => task.profile + '/' + task.suite);
  if (new Set(actualKeys).size !== expected.length)
    throw new Error('Repeated integration cohort task results');
  return expected.flatMap((task) => {
    const actual = report.tasks.find(
      (result) => result.profile === task.profile && result.suite === task.suite,
    );
    if (!actual || actual.status !== 'passed') throw new Error('iOS cohort task did not pass');
    return verifyIosObservationList(actual.observations, task.identifiers);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cohort, path, output, sample = 'first'] = process.argv.slice(2);
  if (
    !output ||
    !/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? '') ||
    !process.env.GITHUB_RUN_ID ||
    !process.env.GITHUB_RUN_ATTEMPT
  )
    throw new Error('iOS aggregation requires its actual workflow context and explicit report');
  const report = JSON.parse(readFileSync(path, 'utf8'));
  const observations = verifyIosTestCohortResults(report, cohort, {
    sourceSha: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT,
    sample,
  });
  writeFileSync(
    output,
    JSON.stringify({ cohort, sample, observations, sourceSha: report.sourceSha }, null, 2) + '\n',
  );
  console.log(`IOS_COHORT_RESULTS_VERIFIED cohort=${cohort} passed=${observations.length}`);
}
