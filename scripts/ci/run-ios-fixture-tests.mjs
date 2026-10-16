import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { iosTestConfig } from './ios-test-config.mjs';
import { iosTestInventory } from './ios-test-inventory.mjs';
import { verifyIosTestSimulator } from './ios-test-simulator.mjs';
import { verifyTestRunContract } from './ios-test-run-contract.mjs';
import { verifyIosTestResults } from './ios-test-results.mjs';
import {
  resetIosTestFixtureContainer,
  removeIosTestFixtureContainer,
} from './ios-test-fixture-container.mjs';
import {
  ensureIosFixtureInstalled,
  iosFixtureResetMode,
  runIosFixtureCommand,
} from './ios-test-scoped-reset.mjs';

const [profile, runFile, ownerFile, output, ...selected] = process.argv.slice(2);
if (
  !['fixtures', 'health-import', 'microphone', 'provider-selection'].includes(profile) ||
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
const started = Date.now();
let attempted = 0;
let lastMode;
for (const [index, identifier] of expected.entries()) {
  attempted += 1;
  const mode = iosFixtureResetMode(profile, identifier);
  const setupStarted = Date.now();
  let setupComplete = false;
  const name = String(index + 1).padStart(2, '0');
  const resultBundle = join(directory, name + '.xcresult');
  try {
    // Fresh-install/key-lifecycle cases retain the full boundary. Ordinary UI starts with observed clean app-owned state.
    if (mode === 'scoped') {
      if (lastMode !== 'scoped') ensureIosFixtureInstalled(profile, owner, app);
      const reset = await runIosFixtureCommand(profile, owner, 'reset');
      writeFileSync(
        join(directory, `reset-${index + 1}.json`),
        JSON.stringify(reset, null, 2) + '\n',
      );
    } else resetIosTestFixtureContainer(profile, owner, app);
    lastMode = mode;
    setupComplete = true;
    console.log(
      'IOS_FIXTURE_SETUP ' +
        JSON.stringify({ identifier, mode, elapsedMs: Date.now() - setupStarted }),
    );
    execFileSync(
      'scripts/ci/run-command.sh',
      [
        'fixture-phase-' + name,
        join(directory, name + '.log'),
        '--',
        process.execPath,
        'scripts/ci/run-ios-tests.mjs',
        profile,
        runFile,
        ownerFile,
        resultBundle,
        identifier,
      ],
      { stdio: 'inherit' },
    );
    const report = JSON.parse(
      execFileSync(
        'xcrun',
        ['xcresulttool', 'get', 'test-results', 'tests', '--path', resultBundle, '--compact'],
        { encoding: 'utf8' },
      ),
    );
    observations.push(...verifyIosTestResults(report, [identifier]));
    execFileSync('xcrun', [
      'xcresulttool',
      'export',
      'attachments',
      '--path',
      resultBundle,
      '--output-path',
      join(directory, name + '-attachments'),
    ]);
  } catch (error) {
    // Preserve setup and test failures separately; only completed preparation permits app cleanup.
    const failure = {
      identifier,
      stage: setupComplete ? 'test' : 'setup',
      error: String(error),
      ...(!setupComplete && { cleanup: 'deferred-to-owned-device-cleanup' }),
    };
    failures.push(failure);
    console.error('IOS_FIXTURE_CASE_FAILED ' + JSON.stringify(failure));
  } finally {
    // Failed preparation may leave a mutation's state uncertain. Never replay it as app cleanup;
    // the caller retains the existing recorded-device cleanup boundary after this failed report.
    if (setupComplete) {
      // The next scoped case resets once before use. On failure or group end, clean immediately after preserving its evidence.
      const cleanupStarted = Date.now();
      try {
        const cleanup =
          mode === 'fresh-install'
            ? removeIosTestFixtureContainer(profile, owner)
            : failures.length ||
                index === expected.length - 1 ||
                iosFixtureResetMode(profile, expected[index + 1]) !== 'scoped'
              ? await runIosFixtureCommand(profile, owner, 'reset')
              : { deferredToNextSetup: true };
        console.log(
          'IOS_FIXTURE_CLEANUP_VERIFIED ' +
            JSON.stringify({
              profile,
              mode,
              device: owner.udid,
              ...cleanup,
              elapsedMs: Date.now() - cleanupStarted,
            }),
        );
      } catch (error) {
        // Cleanup has its own failed observation; it cannot erase the earlier assertion or authorize a later case.
        const failure = { identifier, stage: 'cleanup', error: String(error) };
        failures.push(failure);
        console.error('IOS_FIXTURE_CLEANUP_FAILED ' + JSON.stringify(failure));
      }
    }
  }
  if (failures.length) break;
}
writeFileSync(
  join(directory, 'results.json'),
  JSON.stringify(
    {
      profile,
      suite: selected.length ? 'selected' : suite,
      passed: failures.length === 0 && observations.length === expected.length,
      observations,
      failures,
      notRun: expected.slice(attempted),
      elapsedMs: Date.now() - started,
    },
    null,
    2,
  ) + '\n',
);
if (failures.length || observations.length !== expected.length)
  throw new Error('Fresh fixture inventory contains failed or missing first executions');
console.log(
  `IOS_FIXTURE_RESULTS_VERIFIED passed=${observations.length} elapsed_ms=${Date.now() - started}`,
);
