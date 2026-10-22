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

function evaluateWorkflowExpression(expression, context) {
  const source = expression
    .replace(/^\$\{\{\s*|\s*\}\}$/g, '')
    .replace(/(?:github|inputs|needs)(?:\.[a-z_]+)+/g, (path) => {
      const value = path.split('.').reduce((current, key) => current?.[key], context);
      return typeof value === 'boolean' ? String(value) : JSON.stringify(value ?? '');
    });
  return Function(`"use strict"; return (${source});`)();
}

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

test('the candidate workflow input is optional and its protected statuses are isolated', () => {
  const workflow = yaml.load(readFileSync('.github/workflows/e2e-test.yml', 'utf8'));
  const selectionAction = yaml.load(
    readFileSync('.github/actions/ios-e2e-selection/action.yml', 'utf8'),
  );
  const receiptAction = yaml.load(
    readFileSync('.github/actions/ios-e2e-validation-receipt/action.yml', 'utf8'),
  );
  const candidateContext = {
    github: { event_name: 'workflow_dispatch', ref: 'refs/heads/feature' },
    inputs: { candidate_pr_number: '217' },
    needs: { selection: { outputs: { non_protected_contexts: 'false' } } },
  };

  assert.deepEqual(workflow.on.workflow_dispatch.inputs.candidate_pr_number, {
    description: 'Run complete validation for this open Draft pull request head.',
    required: false,
    type: 'string',
    default: '',
  });
  assert.match(workflow.jobs.required_statuses.name, /Candidate/);
  assert.match(workflow.jobs.ios_simulator_build.name, /Candidate/);
  assert.match(workflow.jobs.selection.name, /Candidate/);
  assert.equal(workflow.permissions['pull-requests'], 'read');
  const candidateVerification = selectionAction.runs.steps.find(
    ({ id }) => id === 'verify_candidate',
  );
  const selected = selectionAction.runs.steps.find(({ id }) => id === 'select');
  assert.equal(candidateVerification.if, "inputs.candidate_pr_number != ''");
  assert.ok(
    selectionAction.runs.steps.indexOf(candidateVerification) <
      selectionAction.runs.steps.indexOf(selected),
  );
  assert.equal(
    selected.env.OROT_IOS_CANDIDATE_HEAD_SHA,
    '${{ steps.verify_candidate.outputs.candidate_head_sha }}',
  );
  for (const output of ['candidate_pr_number', 'candidate_head_ref', 'candidate_head_sha'])
    assert.equal(
      selectionAction.outputs[output].value,
      '${{ steps.verify_candidate.outputs.' + output + ' }}',
    );
  const candidateJobNames = [
    'selection',
    'reuse_ready_evidence',
    'plan',
    'production_validation',
    'oauth_products',
    'oauth_execution',
    'debug_products',
    'release_products',
    'debug_execution',
    'release_execution',
    'completeness',
  ].map((name) => evaluateWorkflowExpression(workflow.jobs[name].name, candidateContext));
  assert.ok(candidateJobNames.every((name) => name.startsWith('Candidate /')));
  assert.equal(new Set(candidateJobNames).size, candidateJobNames.length);
  assert.equal(
    evaluateWorkflowExpression(workflow.jobs.ios_simulator_build.name, candidateContext),
    'Candidate / Receipt',
  );
  assert.equal(
    evaluateWorkflowExpression(workflow.jobs.required_statuses.name, candidateContext),
    'Candidate',
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
});
