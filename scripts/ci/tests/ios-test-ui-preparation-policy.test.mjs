import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';
import { hostConnectionTest } from '../ios-test-preparation-contract.mjs';
import {
  createIosTestUiPreparationGate,
  readIosHostPreparationObservations,
} from '../ios-test-ui-preparation-runner.mjs';

function evidenceDirectory(resultsDirectory) {
  return join(resultsDirectory, '..', 'ui-preparation');
}

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
    DEVELOPER_DIR: '/Applications/Xcode.app/Contents/Developer',
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
    }),
  );
  return directory;
}

function gate(context, tasks, runPreparation, runXcrun = () => JSON.stringify(xcresultReport())) {
  return createIosTestUiPreparationGate({
    tasks,
    profile: 'fixtures',
    runFile: context.runFile,
    ownerFile: context.ownerFile,
    resultsDirectory: context.resultsDirectory,
    environment: context.environment,
    runPreparation,
    runXcrun,
  });
}

test('one cohort job prepares once and verifies this invocation raw host result separately', () => {
  const context = fixture();
  const integrationTask = iosTestCohortTasks('core-integration')[0];
  const uiTask = iosTestCohortTasks('questions')[0];
  const secondUiTask = { ...uiTask, suite: 'recordings' };
  const calls = [];
  const xcrunCalls = [];
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
    );
    assert.deepEqual(
      [prepare(integrationTask), prepare(uiTask), prepare(secondUiTask)],
      [false, true, false],
    );
    assert.equal(calls.length, 1);
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

test('non-UI plans skip preparation and incomplete current evidence cannot be retried', () => {
  const context = fixture();
  const integrationTask = iosTestCohortTasks('core-integration')[0];
  const uiTask = iosTestCohortTasks('questions')[0];
  const calls = [];
  try {
    const noUi = gate(context, [integrationTask], () => calls.push('unexpected'));
    assert.equal(noUi(integrationTask), false);
    assert.deepEqual(calls, []);

    const incomplete = gate(context, [uiTask], () => calls.push('duplicate attempt'));
    assert.throws(() => incomplete(uiTask), /evidence is incomplete/);
    assert.equal(calls.length, 1);
    assert.throws(() => incomplete(uiTask), /first iOS UI preparation attempt did not complete/);
    assert.equal(calls.length, 1);
  } finally {
    rmSync(context.root, { recursive: true, force: true });
  }
});

test('raw xcresult verification requires the exact host case to pass', () => {
  const context = fixture();
  const resultBundle = join(
    evidenceDirectory(context.resultsDirectory),
    'host-preparation.xcresult',
  );
  mkdirSync(resultBundle, { recursive: true });
  const calls = [];
  try {
    const observations = readIosHostPreparationObservations(resultBundle, (command, args) => {
      calls.push({ command, args });
      return JSON.stringify(xcresultReport());
    });
    assert.deepEqual(observations, [
      { identifier: hostConnectionTest, result: 'Passed', duration: 1 },
    ]);
    assert.deepEqual(calls, [
      {
        command: 'xcrun',
        args: ['xcresulttool', 'get', 'test-results', 'tests', '--path', resultBundle, '--compact'],
      },
    ]);
    assert.throws(
      () =>
        readIosHostPreparationObservations(resultBundle, () =>
          JSON.stringify(xcresultReport('Failed')),
        ),
      /did not pass on its first execution/,
    );
  } finally {
    rmSync(context.root, { recursive: true, force: true });
  }
});
