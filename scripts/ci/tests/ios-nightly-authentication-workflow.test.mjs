import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { workflow } from './fixtures/ios-workflow.mjs';

const workflowDirectory = '.github/workflows';
const focusedPath = './.github/workflows/ios-focused.yml';

test('only the daily main schedule starts E2E and it runs the serialized Keychain suite', () => {
  const nightly = workflow(`${workflowDirectory}/e2e-test.yml`);
  assert.deepEqual(Object.keys(nightly.on), ['schedule']);
  assert.deepEqual(nightly.on.schedule, [{ cron: '0 18 * * *' }]);
  assert.ok(
    Object.values(nightly.jobs).every(
      (job) => !/candidate|workflow_dispatch/i.test(String(job.name ?? '')),
    ),
  );
  const selection = workflow('.github/actions/ios-e2e-selection/action.yml');
  assert.equal(selection.inputs?.candidate_pr_number, undefined);
  assert.equal(
    selection.runs.steps.some((step) => step.id === 'verify_candidate'),
    false,
  );
  assert.deepEqual(nightly.jobs.authentication.with, {
    profile: 'ios/core',
    scenario_file: 'apps/mobile/ios/OrotIntegrationTests/KeychainAuthenticationIntegrationTests.m',
    scenario_name: 'group/authentication',
  });
  assert.equal(nightly.jobs.authentication.uses, focusedPath);
  assert.equal(
    nightly.jobs.authentication.if,
    "${{ needs.selection.outputs.validation_tier == 'full' }}",
  );
  assert.deepEqual(nightly.jobs.authentication.needs, [
    'selection',
    'plan',
    'production_validation',
    'oauth_products',
    'oauth_execution',
    'debug_products',
    'release_products',
    'debug_execution',
    'release_execution',
  ]);
  assert.ok(nightly.jobs.completeness.needs.includes('authentication'));
  assert.equal(existsSync(`${workflowDirectory}/e2e-selected.yml`), false);

  const callers = readdirSync(workflowDirectory)
    .filter((name) => name.endsWith('.yml'))
    .flatMap((name) =>
      Object.entries(workflow(`${workflowDirectory}/${name}`).jobs)
        .filter(([, job]) => job.uses === focusedPath)
        .map(([job]) => [name, job]),
    );
  assert.deepEqual(callers, [['e2e-test.yml', 'authentication']]);
});

test('reusable focused execution has no pull request input or API permission', () => {
  const focused = workflow(`${workflowDirectory}/ios-focused.yml`);
  assert.deepEqual(Object.keys(focused.on), ['workflow_call']);
  assert.deepEqual(Object.keys(focused.on.workflow_call.inputs), [
    'profile',
    'scenario_file',
    'scenario_name',
  ]);
  assert.deepEqual(focused.permissions, { contents: 'read' });
  assert.equal(focused.jobs.selection['runs-on'], 'ubuntu-24.04');
  assert.equal(focused.jobs.execution['timeout-minutes'], 20);
});
