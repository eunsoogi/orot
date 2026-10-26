import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('eslint/package.json'))('js-yaml');
const read = (name) => yaml.load(readFileSync('.github/workflows/' + name, 'utf8'));

test('selected reusable workflow jobs are gated by their cohort and configuration inputs', () => {
  const workflow = read('e2e-test.yml');
  assert.equal(
    workflow.jobs.oauth_products.if,
    "${{ needs.plan.outputs.oauth_required == 'true' }}",
  );
  assert.equal(workflow.jobs.debug_products.if, "${{ needs.plan.outputs.has_debug == 'true' }}");
  assert.equal(
    workflow.jobs.release_products.if,
    "${{ needs.plan.outputs.has_release == 'true' }}",
  );
  assert.equal(workflow.jobs.debug_execution.if, "${{ needs.plan.outputs.has_debug == 'true' }}");
  assert.equal(
    workflow.jobs.release_execution.if,
    "${{ needs.plan.outputs.has_release == 'true' }}",
  );
  assert.equal(
    workflow.jobs.debug_execution.with.cohorts,
    '${{ needs.plan.outputs.debug_cohorts }}',
  );
  assert.equal(
    workflow.jobs.release_execution.with.cohorts,
    '${{ needs.plan.outputs.release_cohorts }}',
  );

  for (const [file, expected] of [
    [
      'ios-debug-tests.yml',
      ['provider', 'health_observations', 'health_recovery', 'microphone', 'selection'],
    ],
    [
      'ios-release-tests.yml',
      [
        'core_integration',
        'core_ui',
        'persistence',
        'isolation',
        'backup',
        'local_model',
        'navigation',
        'recordings',
        'questions',
        'calendar',
        'speech',
      ],
    ],
  ]) {
    const reusable = read(file);
    assert.ok(reusable.on.workflow_call.inputs.cohorts);
    for (const id of expected) assert.ok(reusable.jobs[id].if, `${file}/${id}`);
  }
});

test('the protected Build check consumes OAuth evidence only when the selected plan requires it', () => {
  const build = read('e2e-test.yml').jobs.ios_simulator_build;
  const receiptAction = yaml.load(
    readFileSync('.github/actions/ios-e2e-validation-receipt/action.yml', 'utf8'),
  );
  const oauthDownload = receiptAction.runs.steps.find(
    (step) => step.name === 'Read the separate OAuth execution receipt',
  );
  const verify = receiptAction.runs.steps.find(
    (step) => step.name === 'Verify production receipt at this run and head',
  );

  assert.ok(build.needs.includes('plan'));
  assert.equal(oauthDownload.if, "inputs.run_ios == 'true' && inputs.oauth_required == 'true'");
  assert.equal(verify.if, "inputs.run_ios == 'true'");
  assert.equal(verify.env.OROT_IOS_OAUTH_REQUIRED, '${{ inputs.oauth_required }}');
  assert.match(verify.env.OROT_IOS_OAUTH_RECEIPT_PATH, /inputs\.oauth_required/);
  assert.match(verify.run, /ios-production-receipt\.mjs verify/);
  assert.doesNotMatch(verify.run, /oauth-receipt/);
  assert.ok(
    build.steps.some(({ uses }) => uses === './.github/actions/ios-e2e-validation-receipt'),
  );
});

test('the receipt action is checked out before the runner loads it', () => {
  const build = read('e2e-test.yml').jobs.ios_simulator_build;
  const receiptAction = yaml.load(
    readFileSync('.github/actions/ios-e2e-validation-receipt/action.yml', 'utf8'),
  );
  const checkoutIndex = build.steps.findIndex(({ uses }) => uses?.startsWith('actions/checkout@'));
  const receiptIndex = build.steps.findIndex(
    ({ uses }) => uses === './.github/actions/ios-e2e-validation-receipt',
  );

  assert.notEqual(checkoutIndex, -1);
  assert.notEqual(receiptIndex, -1);
  assert.ok(checkoutIndex < receiptIndex);
  assert.equal(
    receiptAction.runs.steps.some(({ uses }) => uses?.startsWith('actions/checkout@')),
    false,
  );
});

test('the selection artifact records the event decision and the result artifact records executed cohorts', () => {
  const selectionAction = readFileSync('.github/actions/ios-e2e-selection/action.yml', 'utf8');
  const selector = readFileSync('scripts/ci/ios-e2e-selection-report.mjs', 'utf8');
  const aggregator = readFileSync('scripts/ci/ios-test-plan-results.mjs', 'utf8');
  assert.match(
    selectionAction,
    /ios-e2e-selection-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/,
  );
  assert.match(selector, /selectedCohorts[\s\S]*notSelectedCohorts[\s\S]*fullValidationDeferred/);
  assert.match(aggregator, /executedCohorts[\s\S]*notExecutedCohorts/);
});
