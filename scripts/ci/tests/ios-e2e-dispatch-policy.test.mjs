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
    .replace(/(?:github|steps|inputs)(?:\.[a-z_]+)+/g, (path) => {
      const value = path.split('.').reduce((current, key) => current?.[key], context);
      return typeof value === 'boolean' ? String(value) : JSON.stringify(value ?? '');
    });
  return Function(`"use strict"; return (${source});`)();
}

test('E2E workflow has ready PR, main push, and manual release entry points', () => {
  const workflow = read('e2e-test.yml');
  assert.deepEqual(workflow.on.pull_request.types, [
    'opened',
    'synchronize',
    'reopened',
    'ready_for_review',
    'converted_to_draft',
    'edited',
  ]);
  assert.deepEqual(workflow.on.push, { branches: ['main'] });
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.candidate_pr_number, {
    description: 'Run complete validation for this open Draft pull request head.',
    required: false,
    type: 'string',
    default: '',
  });
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
      outcome: 'success',
      tier: 'pr',
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
      outcome: 'success',
      tier: 'pr',
    },
    {
      event: 'pull_request',
      ref: 'refs/pull/203/merge',
      draft: false,
      complete: 'true',
      iosBuild: 'false',
      iosTests: 'true',
      expected: true,
      outcome: 'success',
      tier: 'pr',
    },
    {
      event: 'pull_request',
      ref: 'refs/pull/203/merge',
      draft: false,
      complete: 'true',
      iosBuild: 'false',
      iosTests: 'false',
      expected: false,
      outcome: 'success',
      tier: 'pr',
    },
    {
      event: 'workflow_dispatch',
      ref: 'refs/heads/main',
      draft: false,
      complete: 'true',
      iosBuild: 'true',
      iosTests: 'true',
      expected: true,
      outcome: 'success',
      tier: 'full',
    },
    {
      event: 'workflow_dispatch',
      ref: 'refs/heads/feature',
      draft: false,
      complete: 'true',
      iosBuild: 'true',
      iosTests: 'true',
      expected: false,
      outcome: 'success',
      tier: 'diagnostic',
    },
    {
      event: 'pull_request',
      ref: 'refs/pull/203/merge',
      draft: false,
      complete: 'false',
      iosBuild: 'false',
      iosTests: 'false',
      expected: true,
      outcome: 'success',
      tier: 'pr',
    },
    {
      event: 'workflow_dispatch',
      ref: 'refs/heads/feature',
      candidatePrNumber: '217',
      draft: false,
      complete: 'true',
      iosBuild: 'true',
      iosTests: 'true',
      expected: true,
      outcome: 'success',
      tier: 'candidate',
    },
    {
      event: 'workflow_dispatch',
      ref: 'refs/heads/feature',
      candidatePrNumber: '217',
      draft: false,
      complete: 'false',
      iosBuild: 'true',
      iosTests: 'true',
      expected: false,
      outcome: 'failure',
      tier: '',
    },
  ];

  for (const scenario of cases) {
    const result = evaluate(expression, {
      github: {
        event_name: scenario.event,
        ref: scenario.ref,
        event: { pull_request: { draft: scenario.draft } },
      },
      inputs: { candidate_pr_number: scenario.candidatePrNumber ?? '' },
      steps: {
        select: {
          outcome: scenario.outcome,
          outputs: {
            validation_tier: scenario.tier,
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

test('drafts use deferred names while metadata-only edits reuse protected validation names', () => {
  const { jobs } = read('e2e-test.yml');
  assert.equal(jobs.reuse_ready_evidence['runs-on'], 'ubuntu-24.04');
  assert.equal(jobs.reuse_ready_evidence.permissions.actions, 'read');
  const downloads = jobs.reuse_ready_evidence.steps.filter(({ uses }) =>
    uses?.startsWith('actions/download-artifact@'),
  );
  assert.equal(downloads.length, 2);
  assert.ok(
    downloads.every(
      ({ with: inputs }) =>
        inputs['run-id'] === '${{ steps.discover.outputs.source_run_id }}' &&
        inputs['github-token'] === '${{ github.token }}',
    ),
  );
  assert.equal(
    jobs.selection.outputs.metadata_only_edit,
    '${{ steps.select.outputs.metadata_only_edit }}',
  );
  assert.ok(jobs.ios_simulator_build.needs.includes('reuse_ready_evidence'));
  assert.match(jobs.required_statuses.with.metadata_only_edit, /outputs\.metadata_only_edit/);
  assert.match(jobs.required_statuses.with.reuse_result, /needs\.reuse_ready_evidence\.result/);
  assert.match(
    jobs.required_statuses.with.selected_cohorts,
    /needs\.reuse_ready_evidence\.outputs\.selected_cohorts/,
  );

  for (const [event, draft, ref, expected, tier] of [
    ['pull_request', true, 'refs/pull/203/merge', true],
    ['pull_request', false, 'refs/pull/203/merge', false],
    ['workflow_dispatch', false, 'refs/heads/feature', true],
    ['workflow_dispatch', false, 'refs/heads/feature', false, 'candidate'],
  ]) {
    assert.equal(
      evaluate(jobs.selection.outputs.non_protected_contexts, {
        github: { event_name: event, ref, event: { pull_request: { draft } } },
        inputs: { candidate_pr_number: tier === 'candidate' ? '217' : '' },
        steps: {
          select: {
            outputs: {
              validation_tier:
                tier === 'candidate'
                  ? 'candidate'
                  : event === 'workflow_dispatch' && ref !== 'refs/heads/main'
                    ? 'diagnostic'
                    : 'pr',
            },
          },
        },
      }),
      expected,
    );
  }
});
