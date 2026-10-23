import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';
import { hostConnectionTest } from '../ios-test-preparation-contract.mjs';
import { createIosTestUiPreparationGate } from '../ios-test-ui-preparation-runner.mjs';

const evidenceDirectory = (resultsDirectory) => join(resultsDirectory, '..', 'ui-preparation');

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'orot-ui-preparation-policy-'));
  const resultsDirectory = join(root, 'artifacts/ios-cohort/results');
  mkdirSync(resultsDirectory, { recursive: true });
  const runFile = join(root, 'verified-products.xctestrun');
  const ownerFile = join(root, 'simulator-owner.json');
  const owner = { udid: '11111111-2222-4333-8444-555555555555' };
  writeFileSync(runFile, 'verified product archive identity');
  writeFileSync(ownerFile, JSON.stringify(owner));
  const environment = {
    DEVELOPER_DIR: '/Applications/Xcode_27.1.app/Contents/Developer',
  };
  return { root, resultsDirectory, runFile, ownerFile, owner, environment };
}

function xcresultReport(result = 'Passed') {
  return {
    testNodes: [
      {
        nodeType: 'Unit test bundle',
        name: 'OrotIntegrationTests',
        children: [
          {
            nodeType: 'Test Case',
            nodeIdentifier: hostConnectionTest.split('/').slice(1).join('/') + '()',
            result,
            durationInSeconds: 1,
          },
        ],
      },
    ],
  };
}

function writePreparationOutput(context) {
  const directory = evidenceDirectory(context.resultsDirectory);
  mkdirSync(join(directory, 'host-preparation.xcresult'), { recursive: true });
  writeFileSync(
    join(directory, 'host-preparation.json'),
    JSON.stringify({
      profile: 'fixtures',
      observations: [{ identifier: hostConnectionTest, result: 'Passed', duration: 1 }],
    }),
  );
  writeFileSync(
    join(directory, 'ui-bootstrap.json'),
    JSON.stringify({
      profile: 'fixtures',
      udid: context.owner.udid,
      hostConnectionVerified: true,
      selectedXcodeDeveloperDirectory: context.environment.DEVELOPER_DIR,
      elapsedMonotonicMs: 1.25,
    }),
  );
  return directory;
}

function gate(
  context,
  tasks,
  runPreparation,
  runXcrun = () => JSON.stringify(xcresultReport()),
  onTiming = () => {},
) {
  return createIosTestUiPreparationGate({
    tasks,
    profile: 'fixtures',
    runFile: context.runFile,
    ownerFile: context.ownerFile,
    resultsDirectory: context.resultsDirectory,
    environment: context.environment,
    runPreparation,
    runXcrun,
    onTiming,
  });
}

test('one cohort job prepares once and verifies this invocation raw host result separately', () => {
  const context = fixture();
  const integrationTask = iosTestCohortTasks('core-integration')[0];
  const uiTask = iosTestCohortTasks('questions')[0];
  const secondUiTask = { ...uiTask, suite: 'recordings' };
  const calls = [];
  const xcrunCalls = [];
  const timings = [];
  try {
    const prepare = gate(
      context,
      [integrationTask, uiTask, secondUiTask],
      (input) => {
        calls.push(input);
        assert.equal(input.profile, 'fixtures');
        assert.equal(input.suite, 'questions');
        assert.equal(input.runFile, context.runFile);
        assert.equal(input.ownerFile, context.ownerFile);
        assert.equal(input.log, join(context.root, 'artifacts/ios-cohort/ui-preparation.log'));
        writePreparationOutput(context);
      },
      (command, args, options) => {
        xcrunCalls.push({ command, args, options });
        return JSON.stringify(xcresultReport());
      },
      (timing) => {
        assert.equal(xcrunCalls.length, 1);
        timings.push(timing);
      },
    );
    assert.deepEqual(
      [prepare(integrationTask), prepare(uiTask), prepare(secondUiTask)],
      [false, true, false],
    );
    assert.equal(calls.length, 1);
    assert.equal(timings.length, 1);
    assert.ok(Number.isFinite(timings[0].gateElapsedMs));
    assert.ok(timings[0].gateElapsedMs >= 0);
    assert.equal(timings[0].bootstrapElapsedMs, 1.25);
    assert.equal(calls[0].directory, join(context.root, 'artifacts/ios-cohort/ui-preparation'));
    assert.deepEqual(xcrunCalls, [
      {
        command: 'xcrun',
        args: [
          'xcresulttool',
          'get',
          'test-results',
          'tests',
          '--path',
          join(context.root, 'artifacts/ios-cohort/ui-preparation/host-preparation.xcresult'),
          '--compact',
        ],
        options: { encoding: 'utf8' },
      },
    ]);
  } finally {
    rmSync(context.root, { recursive: true, force: true });
  }
});

test('any pre-existing preparation directory is rejected instead of reusing disk evidence', () => {
  for (const completed of [false, true]) {
    const context = fixture();
    const uiTask = iosTestCohortTasks('questions')[0];
    try {
      if (completed) writePreparationOutput(context);
      else mkdirSync(evidenceDirectory(context.resultsDirectory), { recursive: true });
      assert.throws(
        () => gate(context, [uiTask], () => assert.fail('must not run')),
        /cannot be reused/,
      );
    } finally {
      rmSync(context.root, { recursive: true, force: true });
    }
  }
});

test('missing optional bootstrap timing does not invalidate verified host evidence', () => {
  const context = fixture();
  const uiTask = iosTestCohortTasks('questions')[0];
  const timings = [];
  try {
    const prepare = gate(
      context,
      [uiTask],
      () => {
        const directory = writePreparationOutput(context);
        const bootstrapPath = join(directory, 'ui-bootstrap.json');
        const bootstrap = JSON.parse(readFileSync(bootstrapPath, 'utf8'));
        delete bootstrap.elapsedMonotonicMs;
        writeFileSync(bootstrapPath, JSON.stringify(bootstrap));
      },
      undefined,
      (timing) => timings.push(timing),
    );
    assert.equal(prepare(uiTask), true);
    assert.equal(timings.length, 1);
    assert.ok(Number.isFinite(timings[0].gateElapsedMs));
    assert.equal(timings[0].bootstrapElapsedMs, null);
  } finally {
    rmSync(context.root, { recursive: true, force: true });
  }
});

test('a preparation failure remains visible and emits no completed timing result', () => {
  const context = fixture();
  const uiTask = iosTestCohortTasks('questions')[0];
  const timings = [];
  try {
    const prepare = gate(
      context,
      [uiTask],
      () => {
        throw new Error('host preparation failed');
      },
      undefined,
      (timing) => timings.push(timing),
    );
    assert.throws(() => prepare(uiTask), /host preparation failed/);
    assert.deepEqual(timings, []);
  } finally {
    rmSync(context.root, { recursive: true, force: true });
  }
});

test('non-UI plans skip preparation and incomplete current evidence cannot be retried', () => {
  const context = fixture();
  const integrationTask = iosTestCohortTasks('core-integration')[0];
  const uiTask = iosTestCohortTasks('questions')[0];
  const calls = [];
  const timings = [];
  try {
    const noUi = gate(
      context,
      [integrationTask],
      () => calls.push('unexpected'),
      undefined,
      () => timings.push('unexpected'),
    );
    assert.equal(noUi(integrationTask), false);
    assert.deepEqual(calls, []);
    assert.deepEqual(timings, []);

    const incomplete = gate(
      context,
      [uiTask],
      () => calls.push('duplicate attempt'),
      undefined,
      () => timings.push('failed attempt'),
    );
    assert.throws(() => incomplete(uiTask), /evidence is incomplete/);
    assert.equal(calls.length, 1);
    assert.deepEqual(timings, []);
    assert.throws(() => incomplete(uiTask), /first iOS UI preparation attempt did not complete/);
    assert.equal(calls.length, 1);
  } finally {
    rmSync(context.root, { recursive: true, force: true });
  }
});
