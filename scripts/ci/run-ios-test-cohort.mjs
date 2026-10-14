import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { iosTestCohort, iosTestCohortTasks, iosTestCohortSample } from './ios-test-cohorts.mjs';
import { executeIosTestCohortTasks } from './ios-test-cohort-execution.mjs';
import { verifyIosTestSimulator } from './ios-test-simulator.mjs';

const [cohort, runFile, ownerFile, output] = process.argv.slice(2);
if (!output || !existsSync(runFile) || existsSync(output))
  throw new Error(
    'Cohort execution requires verified products, explicit ownership and a new evidence directory',
  );
const definition = iosTestCohort(cohort);
const sample = iosTestCohortSample(cohort, process.env.OROT_IOS_TEST_SAMPLE);
const owner = JSON.parse(readFileSync(ownerFile, 'utf8'));
if (
  owner.cohort !== cohort ||
  verifyIosTestSimulator(owner, definition.profiles[0]).state !== 'Booted'
)
  throw new Error('Cohort execution requires its booted, explicitly compatible destination');
const directory = resolve(output);
mkdirSync(directory, { recursive: true });
const started = Date.now();
const tasks = iosTestCohortTasks(cohort);

function command(stage, log, script, args, suite) {
  execFileSync('scripts/ci/run-command.sh', [stage, log, '--', process.execPath, script, ...args], {
    stdio: 'inherit',
    env: { ...process.env, OROT_IOS_TEST_SUITE: suite },
  });
}

const report = await executeIosTestCohortTasks(tasks, async (task) => {
  if (verifyIosTestSimulator(owner, task.profile).state !== 'Booted')
    throw new Error('Cohort destination changed before task execution');
  const taskDirectory = join(directory, task.profile + '-' + task.suite);
  mkdirSync(taskDirectory);
  const log = join(taskDirectory, 'tests.log');
  if (task.mode === 'backup' || task.mode === 'local-model') {
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
      [task.profile, runFile, ownerFile, results],
      task.suite,
    );
    return JSON.parse(readFileSync(join(results, 'results.json'), 'utf8')).observations;
  }
  const bundle = join(taskDirectory, 'results.xcresult');
  let executionError;
  let observations;
  try {
    command(
      'ios-cohort-' + task.profile,
      log,
      'scripts/ci/run-ios-tests.mjs',
      [task.profile, runFile, ownerFile, bundle],
      task.suite,
    );
    command(
      'ios-cohort-results',
      join(taskDirectory, 'verification.log'),
      'scripts/ci/ios-test-results.mjs',
      [task.profile, bundle, join(taskDirectory, 'results.json')],
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
writeFileSync(
  join(directory, 'results.json'),
  JSON.stringify(
    {
      schemaVersion: 1,
      cohort,
      sample,
      sourceSha: process.env.GITHUB_SHA ?? null,
      runId: process.env.GITHUB_RUN_ID ?? null,
      attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
      ...report,
      elapsedMs: Date.now() - started,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `IOS_COHORT_RESULTS cohort=${cohort} passed=${report.passed} elapsed_ms=${Date.now() - started}`,
);
process.exitCode = report.passed ? 0 : 1;
