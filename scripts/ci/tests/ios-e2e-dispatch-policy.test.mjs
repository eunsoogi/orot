import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('eslint/package.json'))('js-yaml');

test('E2E runs on the daily schedule and supports manual dispatch', () => {
  const workflow = yaml.load(readFileSync('.github/workflows/e2e-test.yml', 'utf8'));
  assert.deepEqual(Object.keys(workflow.on), ['schedule', 'workflow_dispatch']);
  assert.deepEqual(workflow.on.schedule, [{ cron: '0 18 * * *' }]);
  const inputs = workflow.on.workflow_dispatch.inputs;
  assert.deepEqual(inputs.mode, {
    type: 'choice',
    options: ['full', 'candidate', 'report'],
    default: 'full',
  });
  for (const name of ['candidate_pr', 'expected_sha', 'profile', 'scenario_file', 'scenario_name'])
    assert.deepEqual(inputs[name], { type: 'string', required: false });
  for (const name of ['source_run_id', 'source_attempt'])
    assert.deepEqual(inputs[name], { type: 'string', required: false });

  // Report mode avoids the account-wide Mac reservation without changing Full or candidate routing.
  assert.equal(
    workflow.concurrency.group,
    "${{ github.event_name == 'workflow_dispatch' && inputs.mode == 'report' && format('ios-ci-report-{0}', github.run_id) || format('ios-ci-macos-{0}', github.repository) }}",
  );
  assert.equal(
    workflow.jobs.selection.if,
    "${{ github.event_name == 'schedule' || inputs.mode == 'full' }}",
  );
  assert.match(workflow.jobs.candidate.if, /workflow_dispatch.*inputs\.mode == 'candidate'/);
  assert.equal(workflow.jobs.candidate.uses, './.github/workflows/ios-candidate.yml');
  assert.equal(workflow.jobs.completeness.uses, './.github/workflows/ios-test-completeness.yml');
  assert.equal(
    workflow.jobs.completeness.if,
    "${{ always() && (needs.plan.result != 'skipped' || inputs.mode == 'report') }}",
  );
  assert.equal(workflow.jobs.completeness.with.report_only, "${{ inputs.mode == 'report' }}");
  assert.equal(workflow.jobs.completeness.with.source_run_id, '${{ inputs.source_run_id }}');
  assert.equal(workflow.jobs.completeness.with.source_attempt, '${{ inputs.source_attempt }}');
});
