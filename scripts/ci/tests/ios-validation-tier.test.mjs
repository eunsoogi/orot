import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CHECK_KEYS } from '../changed-paths-core.mjs';
import { selectChecksForEvent } from '../select-changed-paths.mjs';
import { IOS_TEST_COHORT_NAMES } from '../ios-test-execution-plan.mjs';
import { iosValidationTierForEvent } from '../ios-validation-tier.mjs';

const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('eslint/package.json'))('js-yaml');

const mainRef = 'refs/heads/main';
const pullRequest = {
  action: 'synchronize',
  pull_request: {
    base: { sha: 'a'.repeat(40) },
    head: { sha: 'b'.repeat(40) },
  },
};

test('event tiers distinguish main Full events, isolated candidates, and diagnostics', () => {
  assert.equal(iosValidationTierForEvent('pull_request', 'refs/pull/216/merge'), 'pr');
  assert.equal(iosValidationTierForEvent('push', mainRef), 'main-impact');
  assert.equal(iosValidationTierForEvent('schedule', mainRef), 'full');
  assert.equal(iosValidationTierForEvent('workflow_dispatch', mainRef), 'full');
  assert.equal(iosValidationTierForEvent('workflow_dispatch', 'refs/heads/feature'), 'diagnostic');
  assert.equal(iosValidationTierForEvent('workflow_dispatch', mainRef, '217'), 'candidate');
  assert.equal(iosValidationTierForEvent('repository_dispatch', mainRef), 'unclassified');
});

test('selection keeps tier provenance even when path impact selects every PR cohort', () => {
  const selection = selectChecksForEvent(
    'pull_request',
    pullRequest,
    () => 'M\0package.json\0',
    null,
    'refs/pull/216/merge',
  );

  assert.equal(selection.validation_tier, 'pr');
  assert.deepEqual(selection.ios_test_cohorts, IOS_TEST_COHORT_NAMES);
});

test('main manual dispatch selects Full while non-main and candidate dispatch stay isolated', () => {
  const schedule = selectChecksForEvent('schedule', {}, () => '', null, mainRef);
  const manual = selectChecksForEvent('workflow_dispatch', {}, () => '', null, mainRef);
  const offMainManual = selectChecksForEvent(
    'workflow_dispatch',
    {},
    () => '',
    null,
    'refs/heads/feature',
  );
  const candidate = selectChecksForEvent('workflow_dispatch', {}, () => '', null, mainRef, '217');

  assert.equal(schedule.validation_tier, 'full');
  assert.deepEqual(schedule.ios_test_cohorts, IOS_TEST_COHORT_NAMES);
  assert.equal(schedule.ios_oauth, true);
  assert.equal(manual.validation_tier, 'full');
  assert.deepEqual(manual.ios_test_cohorts, IOS_TEST_COHORT_NAMES);
  assert.equal(manual.ios_oauth, true);
  assert.equal(candidate.validation_tier, 'candidate');
  assert.equal(offMainManual.validation_tier, 'diagnostic');
});

test('an explicitly validated candidate dispatch gets its own complete Full tier', () => {
  const candidate = selectChecksForEvent(
    'workflow_dispatch',
    {},
    () => '',
    null,
    'refs/heads/feature',
    '217',
  );

  assert.equal(
    iosValidationTierForEvent('workflow_dispatch', 'refs/heads/feature', '217'),
    'candidate',
  );
  assert.equal(candidate.validation_tier, 'candidate');
  assert.deepEqual(candidate.ios_test_cohorts, IOS_TEST_COHORT_NAMES);
  assert.equal(candidate.ios_oauth, true);
  assert.equal(candidate.ios_build, true);
  assert.equal(candidate.ios_tests, true);
});

test('main pushes are impact-based and unknown events never claim a known tier', () => {
  const push = selectChecksForEvent(
    'push',
    { before: 'a'.repeat(40), after: 'b'.repeat(40) },
    () => 'M\0apps/mobile/src/recording/RecordingLibrary.tsx\0',
    null,
    mainRef,
  );
  const unknown = selectChecksForEvent('repository_dispatch', {}, () => '', null, mainRef);

  assert.equal(push.validation_tier, 'main-impact');
  assert.notDeepEqual(push.ios_test_cohorts, IOS_TEST_COHORT_NAMES);
  assert.equal(unknown.validation_tier, 'unclassified');
  assert.equal(
    CHECK_KEYS.every((key) => unknown[key]),
    true,
  );
});

test('the E2E workflow supports daily and manual Full selection and threads tier into completeness', () => {
  const workflow = yaml.load(readFileSync('.github/workflows/e2e-test.yml', 'utf8'));
  const completeness = yaml.load(
    readFileSync('.github/workflows/ios-test-completeness.yml', 'utf8'),
  );

  assert.deepEqual(Object.keys(workflow.on), ['schedule', 'workflow_dispatch']);
  assert.equal(workflow.on.schedule.length, 1);
  assert.equal(workflow.on.schedule[0].cron, '0 18 * * *');
  assert.equal(workflow.on.workflow_dispatch, null);
  assert.equal(
    workflow.jobs.selection.outputs.validation_tier,
    '${{ steps.select.outputs.validation_tier }}',
  );
  assert.equal(
    workflow.jobs.completeness.with.validation_tier,
    '${{ needs.selection.outputs.validation_tier }}',
  );
  assert.equal(completeness.on.workflow_call.inputs.validation_tier.required, true);
});

test('Full validation retains OAuth, Production and provider authentication coverage', () => {
  const workflow = yaml.load(readFileSync('.github/workflows/e2e-test.yml', 'utf8'));
  const receiptAction = yaml.load(
    readFileSync('.github/actions/ios-e2e-validation-receipt/action.yml', 'utf8'),
  );
  const authTests = [
    'OrotUITests/ProviderSelectionUITests/testAuthSessionCancellationRouteExitRetryAndCallbackKeepSelectionExplicit',
    'OrotUITests/ProviderSelectionUITests/testExplicitSelectionAndKeychainRestoreNeverChooseAnAutomaticFallback',
    'OrotUITests/ProviderSelectionUITests/testSignOutCancelsTheOpenResponseAndSurvivesProcessRestartBeforeRelogin',
  ];
  const providerSelection = selectChecksForEvent('schedule', {}, () => '', null, mainRef);
  assert.equal(providerSelection.validation_tier, 'full');
  // The provider-selection execution profile is represented by the maintained `selection` cohort.
  assert.ok(providerSelection.ios_test_cohorts.includes('selection'));
  assert.equal(workflow.jobs.production_validation.needs, 'plan');
  assert.equal(
    workflow.jobs.oauth_products.if,
    "${{ needs.plan.outputs.oauth_required == 'true' }}",
  );
  assert.equal(
    workflow.jobs.oauth_execution.if,
    "${{ needs.plan.outputs.oauth_required == 'true' }}",
  );
  assert.equal(workflow.jobs.debug_products.if, "${{ needs.plan.outputs.has_debug == 'true' }}");
  assert.equal(
    workflow.jobs.release_products.if,
    "${{ needs.plan.outputs.has_release == 'true' }}",
  );
  assert.equal(
    workflow.jobs.completeness.with.validation_tier,
    '${{ needs.selection.outputs.validation_tier }}',
  );
  assert.ok(
    receiptAction.runs.steps.some(
      ({ name }) => name === 'Read the separate OAuth execution receipt',
    ),
  );
  assert.ok(
    receiptAction.runs.steps.some(
      ({ name }) => name === 'Verify production receipt at this run and head',
    ),
  );
  const inventory = readFileSync('scripts/ci/ios-test-inventory.mjs', 'utf8');
  for (const identifier of authTests) assert.ok(inventory.includes(identifier));
});
