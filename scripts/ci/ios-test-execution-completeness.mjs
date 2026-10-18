import { IOS_TEST_COHORT_NAMES, iosTestExecutionPlan } from './ios-test-execution-plan.mjs';

/** Checks that each selected producer and executor ran and each unused configuration was explicitly skipped. */
export function validateIosTestExecutionResults(results, selectedCohorts, oauthRequired) {
  const plan = iosTestExecutionPlan(selectedCohorts);
  if (typeof oauthRequired !== 'boolean')
    throw new Error('Integration completeness requires a boolean OAuth selection');
  if (plan.length !== selectedCohorts.length || plan.length === 0)
    throw new Error('Integration completeness requires a nonempty selected plan');

  const selected = new Set(selectedCohorts);
  const notSelectedCohorts = IOS_TEST_COHORT_NAMES.filter((cohort) => !selected.has(cohort));
  const hasDebug = plan.some((entry) => entry.configuration === 'Debug');
  const hasRelease = plan.some((entry) => entry.configuration === 'Release');
  const expected = {
    plan: 'success',
    production_validation: 'success',
    oauth_products: oauthRequired ? 'success' : 'skipped',
    oauth_execution: oauthRequired ? 'success' : 'skipped',
    debug_products: hasDebug ? 'success' : 'skipped',
    release_products: hasRelease ? 'success' : 'skipped',
    debug_execution: hasDebug ? 'success' : 'skipped',
    release_execution: hasRelease ? 'success' : 'skipped',
  };
  if (!results || typeof results !== 'object' || Array.isArray(results))
    throw new Error('Integration completeness requires a workflow job result object');
  for (const [name, expectedResult] of Object.entries(expected)) {
    if (!Object.hasOwn(results, name))
      throw new Error(`${name} expected ${expectedResult}, received missing`);
    if (results[name]?.result !== expectedResult)
      throw new Error(
        `${name} expected ${expectedResult}, received ${results[name]?.result ?? 'missing'}`,
      );
  }
  const unexpected = Object.keys(results).filter((name) => !Object.hasOwn(expected, name));
  if (unexpected.length)
    throw new Error(`Unexpected integration job results: ${unexpected.join(', ')}`);
  return {
    selectedCohorts,
    notSelectedCohorts,
    executedCohorts: selectedCohorts,
    notExecutedCohorts: [],
    oauthRequired,
  };
}

function requiredJson(name) {
  try {
    return JSON.parse(process.env[name] ?? '');
  } catch {
    throw new Error(`Integration completeness requires valid JSON in ${name}`);
  }
}

function main() {
  const results = requiredJson('OROT_IOS_EXECUTION_RESULTS');
  const cohorts = requiredJson('OROT_IOS_TEST_COHORTS');
  const oauth = process.env.OROT_IOS_OAUTH_TESTS;
  if (oauth !== 'true' && oauth !== 'false')
    throw new Error('Integration completeness requires the OAuth selection decision');
  const summary = validateIosTestExecutionResults(results, cohorts, oauth === 'true');
  process.stdout.write(JSON.stringify(summary) + '\n');
}

if (process.argv[1]?.endsWith('/ios-test-execution-completeness.mjs')) main();
