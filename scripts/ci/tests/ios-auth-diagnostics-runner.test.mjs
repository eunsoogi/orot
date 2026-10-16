import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { posix } from 'node:path';
import test from 'node:test';
import { fixture } from './fixtures/ios-test-runner.mjs';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';

const identifier =
  'OrotUITests/ProviderSelectionUITests/testAuthSessionCancellationRouteExitRetryAndCallbackKeepSelectionExplicit';

for (const status of [0, 65]) {
  test(`Selection retains its bounded auth stream beside the original result and preserves exit ${status}`, () => {
    const result = fixture(status, 'provider-selection', 'ui', [identifier]);
    try {
      assert.equal(result.outcome.status, status, result.outcome.stderr);
      assert.ok(existsSync(result.result + '.auth.jsonl'));
      const metadata = JSON.parse(readFileSync(result.result + '.auth.jsonl.json', 'utf8'));
      assert.equal(metadata.closed, true);
      const streams = result.calls.filter((call) => call.args.includes('stream'));
      assert.equal(streams.length, 1);
      assert.equal(streams[0].args[2], 'fixture-udid');
      assert.equal(
        streams[0].args.at(-1),
        'process == "Orot" AND eventMessage BEGINSWITH "OROT_AUTH_DIAGNOSTIC "',
      );
      assert.equal(result.calls.filter((call) => call.name === 'xcodebuild').length, 1);
    } finally {
      rmSync(result.directory, { recursive: true, force: true });
    }
  });
}

test('ordinary cases do not start the Selection auth collector', () => {
  const result = fixture(0);
  try {
    assert.equal(result.outcome.status, 0, result.outcome.stderr);
    assert.ok(!existsSync(result.result + '.auth.jsonl'));
    assert.equal(result.calls.filter((call) => call.args.includes('stream')).length, 0);
  } finally {
    rmSync(result.directory, { recursive: true, force: true });
  }
});

test('the automatic Selection path retains nested auth diagnostics and raw failure attachments without workflow changes', () => {
  const require = createRequire(import.meta.url);
  const yaml = createRequire(require.resolve('eslint/package.json'))('js-yaml');
  const read = (path) => yaml.load(readFileSync(path, 'utf8'));
  const selection = read('.github/workflows/ios-debug-tests.yml').jobs.selection;
  const executorStep = selection.steps.find(
    (step) => step.uses === './.github/actions/ios-test-cohort-executor',
  );
  assert.equal(executorStep.with.profile, 'provider-selection');
  assert.equal(executorStep.with.cohort, 'selection');
  const executor = read('.github/actions/ios-test-cohort-executor/action.yml');
  assert.ok(
    executor.runs.steps.some((step) => step.uses === './.github/actions/ios-test-cohort-run'),
  );
  const action = read('.github/actions/ios-test-cohort-run/action.yml');
  const execute = action.runs.steps.find((step) => step.run?.includes('run-ios-test-cohort.mjs'));
  assert.ok(execute.run.endsWith('artifacts/ios-cohort/results'));
  const uploads = action.runs.steps.filter((step) =>
    step.uses?.startsWith('actions/upload-artifact@'),
  );
  const root = 'artifacts/ios-cohort/results';
  const [task] = iosTestCohortTasks('selection');
  assert.equal(task.mode, 'fixture');
  assert.equal(task.identifiers[0], identifier);
  const evidence = root + `/${task.profile}-${task.suite}/phases/01.xcresult`;
  for (const path of [evidence, evidence + '.auth.jsonl', evidence + '.auth.jsonl.json']) {
    assert.ok(!posix.relative(root, path).startsWith('..'));
    assert.ok(
      uploads.some((step) => step.if === 'always()' && step.with.path.split('\n').includes(root)),
    );
  }
});
