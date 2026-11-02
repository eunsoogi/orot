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
    options: ['full', 'candidate'],
    default: 'full',
  });
  for (const name of ['candidate_pr', 'expected_sha', 'profile', 'scenario_file', 'scenario_name'])
    assert.deepEqual(inputs[name], { type: 'string', required: false });
  assert.match(workflow.jobs.candidate.if, /workflow_dispatch.*inputs\.mode == 'candidate'/);
  assert.equal(workflow.jobs.candidate.uses, './.github/workflows/ios-candidate.yml');
});
