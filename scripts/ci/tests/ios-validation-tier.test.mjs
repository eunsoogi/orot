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

test('event tiers distinguish PR, main impact, Full, diagnostics, and unknown events', () => {
  assert.equal(iosValidationTierForEvent('pull_request', 'refs/pull/216/merge'), 'pr');
  assert.equal(iosValidationTierForEvent('push', mainRef), 'main-impact');
  assert.equal(iosValidationTierForEvent('schedule', mainRef), 'full');
  assert.equal(iosValidationTierForEvent('workflow_dispatch', mainRef), 'full');
  assert.equal(iosValidationTierForEvent('workflow_dispatch', 'refs/heads/feature'), 'diagnostic');
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

test('scheduled and main-dispatch selections are Full; off-main dispatch is diagnostic', () => {
  const schedule = selectChecksForEvent('schedule', {}, () => '', null, mainRef);
  const releaseCandidate = selectChecksForEvent('workflow_dispatch', {}, () => '', null, mainRef);
  const diagnostic = selectChecksForEvent(
    'workflow_dispatch',
    {},
    () => '',
    null,
    'refs/heads/feature',
  );

  for (const selection of [schedule, releaseCandidate]) {
    assert.equal(selection.validation_tier, 'full');
    assert.deepEqual(selection.ios_test_cohorts, IOS_TEST_COHORT_NAMES);
    assert.equal(selection.ios_oauth, true);
  }
  assert.equal(diagnostic.validation_tier, 'diagnostic');
  assert.deepEqual(diagnostic.ios_test_cohorts, IOS_TEST_COHORT_NAMES);
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

test('the E2E workflow schedules a weekly Full run on main and threads tier into completeness', () => {
  const workflow = yaml.load(readFileSync('.github/workflows/e2e-test.yml', 'utf8'));
  const completeness = yaml.load(
    readFileSync('.github/workflows/ios-test-completeness.yml', 'utf8'),
  );

  assert.equal(workflow.on.schedule.length, 1);
  assert.equal(workflow.on.schedule[0].cron, '0 18 * * 0');
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
