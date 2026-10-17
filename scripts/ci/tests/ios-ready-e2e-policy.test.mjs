import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('eslint/package.json'))('js-yaml');
const read = (name) => yaml.load(readFileSync('.github/workflows/' + name, 'utf8'));

function evaluate(expression, context) {
  const source = expression
    .replace(/^\$\{\{\s*|\s*\}\}$/g, '')
    .replace(/(?:github|steps)(?:\.[a-z_]+)+/g, (path) => {
      const value = path.split('.').reduce((current, key) => current?.[key], context);
      return typeof value === 'boolean' ? String(value) : JSON.stringify(value ?? '');
    });
  return Function(`"use strict"; return (${source});`)();
}

test('automatic full E2E starts on ready PR events and explicit manual release dispatch only', () => {
  const workflow = read('e2e-test.yml');
  assert.deepEqual(workflow.on.pull_request.types, [
    'opened',
    'synchronize',
    'reopened',
    'ready_for_review',
    'converted_to_draft',
    'edited',
  ]);
  assert.equal(workflow.on.push, undefined);
  assert.deepEqual(workflow.on.workflow_dispatch, {});
  assert.ok(workflow.jobs.plan.if.includes("needs.selection.outputs.run_ios == 'true'"));
  assert.doesNotMatch(workflow.jobs.plan.if, /event_name != 'workflow_dispatch'/);
});

test('the workflow selection output never allocates native jobs for drafts or off-main dispatches', () => {
  const selection = read('e2e-test.yml').jobs.selection;
  const expression = selection.outputs.run_ios;
  const cases = [
    {
      event: 'pull_request',
      ref: 'refs/pull/203/merge',
      draft: true,
      complete: 'true',
      iosBuild: 'true',
      iosTests: 'true',
      expected: false,
    },
    {
      event: 'pull_request',
      ref: 'refs/pull/203/merge',
      draft: false,
      metadataOnlyEdit: 'true',
      complete: 'true',
      iosBuild: 'true',
      iosTests: 'true',
      expected: false,
    },
    {
      event: 'pull_request',
      ref: 'refs/pull/203/merge',
      draft: false,
      complete: 'true',
      iosBuild: 'false',
      iosTests: 'true',
      expected: true,
    },
    {
      event: 'pull_request',
      ref: 'refs/pull/203/merge',
      draft: false,
      complete: 'true',
      iosBuild: 'false',
      iosTests: 'false',
      expected: false,
    },
    {
      event: 'workflow_dispatch',
      ref: 'refs/heads/main',
      draft: false,
      complete: 'true',
      iosBuild: 'true',
      iosTests: 'true',
      expected: true,
    },
    {
      event: 'workflow_dispatch',
      ref: 'refs/heads/feature',
      draft: false,
      complete: 'true',
      iosBuild: 'true',
      iosTests: 'true',
      expected: false,
    },
    {
      event: 'pull_request',
      ref: 'refs/pull/203/merge',
      draft: false,
      complete: 'false',
      iosBuild: 'false',
      iosTests: 'false',
      expected: true,
    },
  ];

  for (const scenario of cases) {
    const result = evaluate(expression, {
      github: {
        event_name: scenario.event,
        ref: scenario.ref,
        event: { pull_request: { draft: scenario.draft } },
      },
      steps: {
        select: {
          outputs: {
            selection_complete: scenario.complete,
            metadata_only_edit: scenario.metadataOnlyEdit ?? 'false',
            ios_build: scenario.iosBuild,
            ios_tests: scenario.iosTests,
          },
        },
      },
    });
    assert.equal(result, scenario.expected, JSON.stringify(scenario));
  }
});

test('draft and metadata-only events use check names outside branch protection', () => {
  const workflow = read('e2e-test.yml');
  assert.ok(workflow.jobs.ios_simulator_build.name.includes('non_protected_contexts'));
  assert.ok(workflow.jobs.required_statuses.name.includes('non_protected_contexts'));
  assert.equal(
    workflow.jobs.required_statuses.with.selected_cohorts,
    '${{ needs.selection.outputs.ios_test_cohorts }}',
  );
  assert.ok(workflow.jobs.required_statuses.with.non_protected_contexts);
});

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
    ['ios-debug-tests.yml', ['provider', 'health', 'microphone', 'selection']],
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
  const oauthDownload = build.steps.find(
    (step) => step.name === 'Read the separate OAuth execution receipt',
  );
  const verify = build.steps.find(
    (step) => step.name === 'Verify production receipt at this run and head',
  );

  assert.ok(build.needs.includes('plan'));
  assert.equal(
    oauthDownload.if,
    "needs.selection.outputs.run_ios == 'true' && needs.plan.outputs.oauth_required == 'true'",
  );
  assert.equal(verify.if, "needs.selection.outputs.run_ios == 'true'");
  assert.equal(verify.env.OROT_IOS_OAUTH_REQUIRED, '${{ needs.plan.outputs.oauth_required }}');
  assert.match(verify.env.OROT_IOS_OAUTH_RECEIPT_PATH, /needs\.plan\.outputs\.oauth_required/);
  assert.match(verify.run, /ios-production-receipt\.mjs verify/);
  assert.doesNotMatch(verify.run, /oauth-receipt/);
});

test('the selection artifact records the event decision and the result artifact records executed cohorts', () => {
  const source = readFileSync('.github/workflows/e2e-test.yml', 'utf8');
  const selector = readFileSync('scripts/ci/select-changed-paths.mjs', 'utf8');
  const aggregator = readFileSync('scripts/ci/ios-test-plan-results.mjs', 'utf8');
  assert.match(
    source,
    /ios-e2e-selection-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/,
  );
  assert.match(selector, /selectedCohorts[\s\S]*notSelectedCohorts[\s\S]*fullValidationDeferred/);
  assert.match(aggregator, /executedCohorts[\s\S]*notExecutedCohorts/);
});
