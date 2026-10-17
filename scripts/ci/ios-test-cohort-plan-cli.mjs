import { appendFileSync } from 'node:fs';
import { iosTestExecutionPlan } from './ios-test-execution-plan.mjs';
import { iosTestCohortTasks } from './ios-test-cohorts.mjs';

// Validate coverage before Mac allocation and report compatible groups for the explicit independent feature jobs.
if (!process.env.GITHUB_OUTPUT) throw new Error('iOS planning requires workflow outputs');
const plan = iosTestExecutionPlan();
for (const configuration of ['Debug', 'Release']) {
  const include = plan.filter((entry) => entry.configuration === configuration);
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `${configuration.toLowerCase()}_matrix=${JSON.stringify({ include })}\n`,
  );
}
const observations = plan.flatMap((entry) =>
  iosTestCohortTasks(entry.cohort).flatMap((task) => task.identifiers),
);
console.log(
  JSON.stringify({
    macJobs: plan.length + 5,
    maximumConcurrentMacJobs: plan.length + 2,
    uniqueTestCases: new Set(observations).size,
    scheduledTestObservations: observations.length,
    builds: ['Release', 'Debug', 'Production', 'OAuth'],
    cohorts: plan,
  }),
);
