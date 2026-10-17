import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { iosTestConfig } from './ios-test-config.mjs';
import { backupTests, iosTestInventory } from './ios-test-inventory.mjs';
import { verifyIosTestSimulator } from './ios-test-simulator.mjs';
import { verifyTestRunContract } from './ios-test-run-contract.mjs';
import { readIosTestObservations, verifyIosTestResults } from './ios-test-results.mjs';
import {
  resetIosTestFixtureContainer,
  removeIosTestFixtureContainer,
} from './ios-test-fixture-container.mjs';
import {
  ensureIosFixtureInstalled,
  iosFixtureResetMode,
  runIosFixtureCommand,
} from './ios-test-scoped-reset.mjs';

import { executeIosFixtureSession } from './ios-test-fixture-session.mjs';

const [profile, runFile, ownerFile, output, ...selected] = process.argv.slice(2);
if (
  !['fixtures', 'health-import', 'microphone', 'provider-selection', 'backup'].includes(profile) ||
  !output ||
  !existsSync(runFile) ||
  existsSync(output)
)
  throw new Error(
    'Fresh fixture execution requires its profile, products, ownership and new evidence directory',
  );
const spec = iosTestConfig(profile);
const inventory = iosTestInventory(profile);
const suite = process.env.OROT_IOS_TEST_SUITE ?? 'all';
const expected = selected.length ? selected : iosTestInventory(profile, suite);
// Snapshot seed/recovery require their sealed original result and host transfer between separate invocations.
if (
  profile === 'backup' &&
  (!selected.length || selected.some((id) => !backupTests.slice(0, 3).includes(id)))
)
  throw new Error('Backup fixture sessions contain only independent fresh-container cases');
if (
  new Set(selected).size !== selected.length ||
  selected.some((identifier) => !inventory.includes(identifier))
)
  throw new Error('Unknown or repeated fresh fixture selection');
const owner = JSON.parse(readFileSync(ownerFile, 'utf8'));
if (verifyIosTestSimulator(owner, profile).state !== 'Booted')
  throw new Error('Fresh fixtures require their booted owned destination');
const runData = JSON.parse(
  execFileSync('plutil', ['-convert', 'json', '-o', '-', runFile], { encoding: 'utf8' }),
);
verifyTestRunContract(runData, spec);
const app = join(dirname(resolve(runFile)), spec.configuration + '-iphonesimulator', spec.appName);
if (!existsSync(app)) throw new Error('The verified fixture application is missing');
const directory = resolve(output);
mkdirSync(directory, { recursive: true });
const observations = [];
const failures = [];
const attempted = new Set();
const started = Date.now();
let current;
let lastMode;

async function cleanup(passed) {
  if (!current?.setupComplete) return;
  const { identifier, mode } = current;
  try {
    const result =
      mode === 'fresh-install'
        ? removeIosTestFixtureContainer(profile, owner)
        : !passed || attempted.size === expected.length
          ? await runIosFixtureCommand(profile, owner, 'reset')
          : { deferredToNextSetup: true };
    console.log(
      'IOS_FIXTURE_CLEANUP_VERIFIED ' +
        JSON.stringify({ identifier, profile, mode, device: owner.udid, ...result }),
    );
  } catch (error) {
    failures.push({ identifier, stage: 'cleanup', error: String(error) });
    throw error;
  } finally {
    current = undefined;
  }
}

const bundle = join(directory, 'session.xcresult');
const session = await executeIosFixtureSession({
  identifiers: expected,
  command: [
    'scripts/ci/run-command.sh',
    'fixture-session',
    join(directory, 'session.log'),
    '--',
    process.execPath,
    'scripts/ci/run-ios-tests.mjs',
    profile,
    runFile,
    ownerFile,
    bundle,
    ...expected,
  ],
  async handle({ identifier, stage, passed }) {
    if (stage === 'complete') {
      if (!passed && current?.setupComplete)
        failures.push({ identifier, stage: 'test', error: 'Original XCTest case failed' });
      await cleanup(passed);
      return;
    }
    attempted.add(identifier);
    const mode = iosFixtureResetMode(profile, identifier);
    current = { identifier, mode, setupComplete: false };
    const setupStarted = Date.now();
    try {
      // The runner is shared; every case still waits for its original explicit host reset before setup/body executes.
      if (mode === 'scoped') {
        if (lastMode !== 'scoped') ensureIosFixtureInstalled(profile, owner, app);
        const reset = await runIosFixtureCommand(profile, owner, 'reset');
        writeFileSync(
          join(directory, `reset-${attempted.size}.json`),
          JSON.stringify({ identifier, ...reset }, null, 2) + '\n',
        );
      } else resetIosTestFixtureContainer(profile, owner, app);
      lastMode = mode;
      current.setupComplete = true;
      console.log(
        'IOS_FIXTURE_SETUP ' +
          JSON.stringify({ identifier, mode, elapsedMs: Date.now() - setupStarted }),
      );
    } catch (error) {
      failures.push({
        identifier,
        stage: 'setup',
        error: String(error),
        cleanup: 'deferred-to-owned-device-cleanup',
      });
      throw error;
    }
  },
});
// An interrupted case may never deliver didFinish. Clean only a completed preparation and preserve the original process failure.
try {
  await cleanup(false);
} catch (error) {
  console.error('IOS_FIXTURE_CLEANUP_FAILED ' + String(error));
}
let rawObservations = [];
let resultVerificationError;
try {
  if (!existsSync(bundle)) throw new Error('Fixture runner produced no original xcresult');
  const report = JSON.parse(
    execFileSync(
      'xcrun',
      ['xcresulttool', 'get', 'test-results', 'tests', '--path', bundle, '--compact'],
      { encoding: 'utf8' },
    ),
  );
  writeFileSync(join(directory, 'original-tests.json'), JSON.stringify(report, null, 2) + '\n');
  rawObservations = readIosTestObservations(report);
  observations.push(...rawObservations.filter((item) => item.result === 'Passed'));
  verifyIosTestResults(report, expected);
} catch (error) {
  resultVerificationError = String(error);
  if (!failures.length) failures.push({ stage: 'results', error: resultVerificationError });
}
if (existsSync(bundle)) {
  try {
    execFileSync('xcrun', [
      'xcresulttool',
      'export',
      'attachments',
      '--path',
      bundle,
      '--output-path',
      join(directory, 'attachments'),
    ]);
  } catch (error) {
    failures.push({ stage: 'attachments', error: String(error) });
  }
}
if ((session.status !== 0 || session.failure) && !failures.length)
  failures.push({ stage: 'runner', error: session.failure ?? 'Runner exit ' + session.status });
const passed =
  !failures.length && observations.length === expected.length && attempted.size === expected.length;
writeFileSync(
  join(directory, 'results.json'),
  JSON.stringify(
    {
      profile,
      suite: selected.length ? 'selected' : suite,
      passed,
      observations,
      rawObservations,
      resultVerificationError,
      failures,
      notRun: expected.filter((identifier) => !attempted.has(identifier)),
      session,
      elapsedMs: Date.now() - started,
    },
    null,
    2,
  ) + '\n',
);
if (!passed) throw new Error('Fresh fixture inventory contains failed or missing first executions');
console.log(
  `IOS_FIXTURE_RESULTS_VERIFIED passed=${observations.length} elapsed_ms=${Date.now() - started}`,
);
