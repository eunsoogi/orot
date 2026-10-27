import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  iosTestCohort,
  iosTestCohortTasks,
  verifyIosSimulatorOwnerContract,
} from './ios-test-cohorts.mjs';
import { createIosTestUiPreparationGate } from './ios-test-ui-preparation-runner.mjs';
import { executeIosTestCohortTasks } from './ios-test-cohort-execution.mjs';

const [cohort, runFile, ownerFile, output] = process.argv.slice(2);
if (!output || !existsSync(runFile) || existsSync(output))
  throw new Error(
    'Cohort execution requires verified products, explicit ownership and a new evidence directory',
  );
const definition = iosTestCohort(cohort);
const profile = process.env.PROFILE;
if (profile !== definition.profiles[0])
  throw new Error('Cohort execution requires the verified representative product profile');
const owner = JSON.parse(readFileSync(ownerFile, 'utf8'));
if (owner.cohort !== cohort) throw new Error('Cohort execution requires its explicit owner');
verifyIosSimulatorOwnerContract(owner, definition.profiles[0]);
const directory = resolve(output);
mkdirSync(directory, { recursive: true });
const tasks = iosTestCohortTasks(cohort);
const uiPreparationTiming = { gateElapsedMs: null, bootstrapElapsedMs: null };

function command(stage, log, script, args, suite) {
  execFileSync('scripts/ci/run-command.sh', [stage, log, '--', process.execPath, script, ...args], {
    stdio: 'inherit',
    env: { ...process.env, OROT_IOS_TEST_SUITE: suite },
  });
}

const prepareUi = createIosTestUiPreparationGate({
  tasks,
  profile,
  runFile,
  ownerFile,
  resultsDirectory: directory,
  onTiming: (timing) => Object.assign(uiPreparationTiming, timing),
  runPreparation: ({
    profile: preparationProfile,
    suite: preparationSuite,
    runFile: preparationRunFile,
    ownerFile: preparationOwnerFile,
    directory: preparationDirectory,
    log,
  }) =>
    command(
      'ios-ui-preparation',
      log,
      'scripts/ci/prepare-ios-test-ui.mjs',
      [preparationProfile, preparationRunFile, preparationOwnerFile, preparationDirectory],
      preparationSuite,
    ),
});
for (const task of tasks) prepareUi(task);
const started = Date.now();

const report = await executeIosTestCohortTasks(tasks, async (task) => {
  // Each execution/reset driver reads live ownership immediately before its Apple operation. The coordinator performs no Simulator mutation and must not repeat that inventory.
  const taskDirectory = join(directory, task.profile + '-' + task.suite);
  mkdirSync(taskDirectory);
  const log = join(taskDirectory, 'tests.log');
  if (
    [
      'backup',
      'local-model',
      'speech-journey',
      'fixture-isolation',
      'recording-persistence',
      'state-persistence',
      'encounter-review-persistence',
      'shared-persistence',
    ].includes(task.mode)
  ) {
    const results = join(taskDirectory, 'phases');
    command(
      'ios-cohort-' + task.profile,
      log,
      `scripts/ci/run-ios-${task.mode}-tests.mjs`,
      [runFile, ownerFile, results],
      task.suite,
    );
    return JSON.parse(readFileSync(join(results, 'results.json'), 'utf8')).observations;
  }
  if (task.mode === 'fixture') {
    const results = join(taskDirectory, 'phases');
    command(
      'ios-cohort-' + task.profile,
      log,
      'scripts/ci/run-ios-fixture-tests.mjs',
      [task.profile, runFile, ownerFile, results, ...task.identifiers],
      task.suite,
    );
    return JSON.parse(readFileSync(join(results, 'results.json'), 'utf8')).observations;
  }
  // Plain tasks can partition a suite too. Bind execution and verification to the same planned subset.
  const bundle = join(taskDirectory, 'results.xcresult');
  let executionError;
  let observations;
  try {
    command(
      'ios-cohort-' + task.profile,
      log,
      'scripts/ci/run-ios-tests.mjs',
      [task.profile, runFile, ownerFile, bundle, ...task.identifiers],
      task.suite,
    );
    command(
      'ios-cohort-results',
      join(taskDirectory, 'verification.log'),
      'scripts/ci/ios-test-results.mjs',
      [task.profile, bundle, join(taskDirectory, 'results.json'), ...task.identifiers],
      task.suite,
    );
    observations = JSON.parse(
      readFileSync(join(taskDirectory, 'results.json'), 'utf8'),
    ).observations;
  } catch (error) {
    executionError = error;
  }
  // Export first-attempt evidence before proceeding, including when Xcode reports an unsuccessful task.
  if (existsSync(bundle)) {
    try {
      execFileSync(
        'xcrun',
        [
          'xcresulttool',
          'export',
          'attachments',
          '--path',
          bundle,
          '--output-path',
          join(taskDirectory, 'attachments'),
        ],
        { stdio: 'inherit' },
      );
    } catch (error) {
      if (!executionError) executionError = error;
      console.error(
        'iOS attachment export unavailable after the preserved first failure: ' + String(error),
      );
    }
  }
  if (executionError) throw executionError;
  return observations;
});
const elapsedMs = Date.now() - started;
const uiPreparationLogValue = uiPreparationTiming.gateElapsedMs ?? 'not_required';
const uiBootstrapLogValue =
  uiPreparationTiming.gateElapsedMs === null
    ? 'not_required'
    : (uiPreparationTiming.bootstrapElapsedMs ?? 'not_measured');
writeFileSync(
  join(directory, 'results.json'),
  JSON.stringify(
    {
      // Evidence is bound to this workflow identity; another run or attempt cannot satisfy its gate.
      schemaVersion: 2,
      cohort,
      sourceSha: process.env.GITHUB_SHA ?? null,
      runId: process.env.GITHUB_RUN_ID ?? null,
      attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
      ...report,
      // Keep elapsedMs scoped to planned task execution; preparation is reported as its own monotonic interval.
      elapsedMs,
      uiPreparationElapsedMs: uiPreparationTiming.gateElapsedMs,
      uiBootstrapElapsedMs: uiPreparationTiming.bootstrapElapsedMs,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `IOS_COHORT_RESULTS cohort=${cohort} passed=${report.passed} elapsed_ms=${elapsedMs} ui_preparation_ms=${uiPreparationLogValue} ui_bootstrap_ms=${uiBootstrapLogValue}`,
);
process.exitCode = report.passed ? 0 : 1;
