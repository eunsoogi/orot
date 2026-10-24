import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { posix } from 'node:path';
import test from 'node:test';
import {
  authFixtureRecord,
  authStreamCalls,
  fixture,
  lifecycleStreamCalls,
} from './fixtures/ios-test-runner.mjs';
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
      assert.equal(metadata.complete, true);
      assert.equal(metadata.accepted, 1);
      assert.equal(metadata.rejected, 0);
      assert.equal(metadata.exitedBeforeStop, false);
      assert.equal(metadata.signal, 'SIGTERM');
      assert.deepEqual(
        readFileSync(result.result + '.auth.jsonl', 'utf8')
          .trim()
          .split('\n')
          .map(JSON.parse),
        [authFixtureRecord],
      );
      const streams = authStreamCalls(result.calls);
      assert.equal(streams.length, 1);
      assert.equal(lifecycleStreamCalls(result.calls).length, 1);
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

// A collector stopped before its first record remains unavailable while the original test exit wins.
for (const status of [0, 65]) {
  test(`Selection preserves exit ${status} with held collector startup`, () => {
    const result = fixture(status, 'provider-selection', 'ui', [identifier], {}, 'held');
    try {
      assert.equal(result.outcome.status, status, result.outcome.stderr);
      const metadata = JSON.parse(readFileSync(result.result + '.auth.jsonl.json', 'utf8'));
      assert.equal(metadata.closed, true);
      assert.equal(metadata.complete, false);
      assert.equal(metadata.accepted, 0);
      assert.equal(readFileSync(result.result + '.auth.jsonl', 'utf8'), '');
      assert.match(result.outcome.stderr, /IOS_AUTH_DIAGNOSTIC_UNAVAILABLE/);
      assert.equal(authStreamCalls(result.calls).length, 0);
      assert.equal(lifecycleStreamCalls(result.calls).length, 1);
      assert.equal(result.calls.filter((call) => call.name === 'xcodebuild').length, 1);
      assert.equal(metadata.signal, 'SIGTERM');
      assert.equal(metadata.stopRequested, true);
      assert.equal(metadata.unexpectedExit, false);
    } finally {
      rmSync(result.directory, { recursive: true, force: true });
    }
  });
}

test('a missing synthetic auth capture fails its bounded handshake', { timeout: 20000 }, () => {
  const started = performance.now();
  const result = fixture(0, 'provider-selection', 'ui', [identifier], {}, 'stalled');
  try {
    assert.equal(
      result.outcome.error,
      undefined,
      'The inner handshake must end before the CLI guard',
    );
    assert.equal(result.outcome.status, 1, result.outcome.stderr);
    assert.match(result.outcome.stderr, /Synthetic diagnostic handshake timed out/);
    assert.ok(performance.now() - started < 15000);
    const metadata = JSON.parse(readFileSync(result.result + '.auth.jsonl.json', 'utf8'));
    assert.equal(metadata.complete, false);
    assert.equal(metadata.closed, true);
    assert.equal(metadata.accepted, 0);
    assert.equal(result.calls.filter((call) => call.name === 'xcodebuild').length, 1);
  } finally {
    rmSync(result.directory, { recursive: true, force: true });
  }
});

test('ordinary cases do not start the Selection auth collector', () => {
  const result = fixture(0);
  try {
    assert.equal(result.outcome.status, 0, result.outcome.stderr);
    assert.ok(!existsSync(result.result + '.auth.jsonl'));
    assert.equal(authStreamCalls(result.calls).length, 0);
    assert.equal(lifecycleStreamCalls(result.calls).length, 1);
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
