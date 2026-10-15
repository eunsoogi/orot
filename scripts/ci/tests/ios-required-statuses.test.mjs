import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { REQUIRED_CI_JOBS_BY_WORKFLOW } from '../../release/ci-required-jobs.mjs';

const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('eslint/package.json'))('js-yaml');
const readWorkflow = (name) =>
  yaml.load(readFileSync(new URL('../../../.github/workflows/' + name, import.meta.url), 'utf8'));
const workflow = readWorkflow('ios-required-statuses.yml');
const status = workflow.jobs.status;

test('five domain statuses map exactly to the release gate through one reusable workflow', () => {
  const caller = readWorkflow('e2e-test.yml').jobs.required_statuses;
  assert.equal(caller.name, 'E2E / Validate');
  assert.equal(caller.uses, './.github/workflows/ios-required-statuses.yml');
  assert.equal(caller.if, 'always()');
  assert.deepEqual(caller.needs, ['selection', 'ios_validation']);
  assert.deepEqual(Object.keys(workflow.jobs), ['status']);
  assert.equal(status.name, '${{ matrix.check }}');
  assert.equal(status.if, 'always()');
  assert.equal(status['runs-on'], 'ubuntu-24.04');
  assert.equal(status.strategy['fail-fast'], false);
  const names = status.strategy.matrix.check.map((name) => caller.name + ' / ' + name);
  assert.deepEqual(names, REQUIRED_CI_JOBS_BY_WORKFLOW['.github/workflows/e2e-test.yml'].slice(1));
  assert.equal(new Set(names).size, 5);
});

test('actual status commands reject invalid selection and every incomplete selected execution', () => {
  const reject = status.steps.find((step) => step.env?.INVALID);
  const requireExecution = status.steps.find((step) => step.env?.RESULT);
  assert.equal(reject.if, undefined);
  assert.equal(requireExecution.if, 'inputs.selected');
  assert.ok(status.steps.some((step) => step.if === '!inputs.selected'));

  // Run the workflow's actual shell guards. This proves guard behavior, not hosted check creation or protection settings.
  for (const invalid of [false, true]) {
    for (const selected of [false, true]) {
      for (const result of ['success', 'failure', 'cancelled', 'skipped', '']) {
        const env = { ...process.env, INVALID: String(invalid), RESULT: result };
        const selectionResult = spawnSync('/bin/bash', ['-c', reject.run], { env });
        const executionResult =
          selectionResult.status === 0 && selected
            ? spawnSync('/bin/bash', ['-c', requireExecution.run], { env })
            : selectionResult;
        assert.equal(
          executionResult.status === 0,
          !invalid && (!selected || result === 'success'),
          JSON.stringify({ invalid, selected, result }),
        );
      }
    }
  }
});
