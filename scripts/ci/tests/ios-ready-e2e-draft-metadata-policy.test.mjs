import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('eslint/package.json'))('js-yaml');

test('draft metadata defers Build while ready metadata still requires reusable evidence', () => {
  const workflow = yaml.load(readFileSync('.github/workflows/e2e-test.yml', 'utf8'));
  const receiptAction = yaml.load(
    readFileSync('.github/actions/ios-e2e-validation-receipt/action.yml', 'utf8'),
  );
  const invocation = workflow.jobs.ios_simulator_build.steps.find(
    ({ uses }) => uses === './.github/actions/ios-e2e-validation-receipt',
  );
  const guard = receiptAction.runs.steps.find(
    ({ name }) => name === 'Require the applicable ready validation evidence',
  );
  assert.equal(invocation.uses, './.github/actions/ios-e2e-validation-receipt');
  const check = (values) =>
    spawnSync('sh', ['-ec', guard.run], {
      encoding: 'utf8',
      env: { ...process.env, ...values },
    }).status;

  assert.equal(
    check({
      COMPLETE: 'true',
      DIAGNOSTIC: 'false',
      RUN_IOS: 'false',
      DEFERRED: 'true',
      METADATA_ONLY_EDIT: 'true',
      REUSE_RESULT: 'skipped',
    }),
    0,
  );
  assert.notEqual(
    check({
      COMPLETE: 'true',
      DIAGNOSTIC: 'false',
      RUN_IOS: 'false',
      DEFERRED: 'false',
      METADATA_ONLY_EDIT: 'true',
      REUSE_RESULT: 'skipped',
    }),
    0,
  );
  assert.equal(
    check({
      COMPLETE: 'true',
      DIAGNOSTIC: 'false',
      RUN_IOS: 'false',
      DEFERRED: 'false',
      METADATA_ONLY_EDIT: 'false',
      REUSE_RESULT: 'skipped',
    }),
    0,
  );
});
