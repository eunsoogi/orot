import { appendFileSync } from 'node:fs';
import { IOS_TEST_COHORT_NAMES, iosTestExecutionPlan } from './ios-test-execution-plan.mjs';
import { iosTestCohortTasks } from './ios-test-cohorts.mjs';

// Validate the complete maintained inventory before emitting only the requested compatible cohort groups.
if (!process.env.GITHUB_OUTPUT) throw new Error('iOS planning requires workflow outputs');
let selectedCohorts;
try {
  selectedCohorts = JSON.parse(process.env.OROT_IOS_TEST_COHORTS ?? '');
} catch {
  throw new Error('iOS planning requires a JSON cohort selection');
}
const plan = iosTestExecutionPlan(selectedCohorts);
const oauthRequired = process.env.OROT_IOS_OAUTH_TESTS;
if (oauthRequired !== 'true' && oauthRequired !== 'false')
  throw new Error('iOS planning requires the OAuth selection decision');
const notSelectedCohorts = IOS_TEST_COHORT_NAMES.filter(
  (cohort) => !selectedCohorts.includes(cohort),
);
for (const configuration of ['Debug', 'Release']) {
  const include = plan.filter((entry) => entry.configuration === configuration);
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `${configuration.toLowerCase()}_matrix=${JSON.stringify({ include })}\n`,
  );
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `${configuration.toLowerCase()}_cohorts=${JSON.stringify(include.map((entry) => entry.cohort))}\n`,
  );
}
appendFileSync(
  process.env.GITHUB_OUTPUT,
  `selected_cohorts=${JSON.stringify(plan.map((entry) => entry.cohort))}\n`,
);
appendFileSync(
  process.env.GITHUB_OUTPUT,
  `not_selected_cohorts=${JSON.stringify(notSelectedCohorts)}\n`,
);
const observations = plan.flatMap((entry) =>
  iosTestCohortTasks(entry.cohort).flatMap((task) => task.identifiers),
);
const hasDebug = plan.some((entry) => entry.configuration === 'Debug');
const hasRelease = plan.some((entry) => entry.configuration === 'Release');
const runOauth = oauthRequired === 'true';
appendFileSync(
  process.env.GITHUB_OUTPUT,
  `has_debug=${hasDebug}\nhas_release=${hasRelease}\noauth_required=${runOauth}\n`,
);
if (process.env.GITHUB_STEP_SUMMARY) {
  // Keep the planned and omitted cohorts visible even when a later producer fails.
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      '## Planned iOS E2E cohorts',
      '',
      `Selected cohorts: ${plan.map((entry) => entry.cohort).join(', ')}.`,
      `Not selected cohorts: ${notSelectedCohorts.join(', ') || 'none'}.`,
      `OAuth suite: ${runOauth ? 'selected' : 'not selected'}.`,
      '',
    ].join('\n'),
  );
}
console.log(
  JSON.stringify({
    selectedCohorts: plan.map((entry) => entry.cohort),
    notSelectedCohorts,
    oauthRequired: runOauth,
    macJobs: plan.length + 1 + Number(hasDebug) + Number(hasRelease) + (runOauth ? 2 : 0),
    maximumConcurrentMacJobs: plan.length + Number(runOauth) + 1,
    uniqueTestCases: new Set(observations).size,
    scheduledTestObservations: observations.length,
    builds: [
      ...(hasRelease ? ['Release'] : []),
      ...(hasDebug ? ['Debug'] : []),
      'Production',
      ...(runOauth ? ['OAuth'] : []),
    ],
    cohorts: plan,
  }),
);
