import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { iosTestConfig, speechJourneyTests } from './ios-test-config.mjs';
import { backupTests, iosTestInventory } from './ios-test-inventory.mjs';
import { verifyIosTestSimulator } from './ios-test-simulator.mjs';
import { iosTestResourceSampler } from './ios-test-resources.mjs';
import { isIosHostPreparation } from './ios-test-preparation-contract.mjs';
import { startIosSpeechDiagnostics } from './ios-speech-diagnostics.mjs';
import { authDiagnosticTest, startIosAuthDiagnostics } from './ios-auth-diagnostics.mjs';
import { fixtureIsolationTests } from './fixture-isolation-test-phases.mjs';
import { recordingPersistenceTests } from './recording-persistence-test-phases.mjs';
import { statePersistenceTests, statePersistencePhases } from './state-persistence-test-phases.mjs';
import { verifySharedPersistenceSelection } from './shared-persistence-test-phases.mjs';

const [profile, runFile, ownerFile, results, ...selected] = process.argv.slice(2);
if (!results)
  throw new Error(
    'Usage: run-ios-tests.mjs <profile> <xctestrun> <owner-file> <xcresult> [test-identifiers]',
  );
const spec = iosTestConfig(profile);
const owner = JSON.parse(readFileSync(ownerFile, 'utf8'));
if (verifyIosTestSimulator(owner, profile).state !== 'Booted')
  throw new Error('iOS tests require their booted owned simulator');
if (!existsSync(runFile) || existsSync(results))
  throw new Error('Missing products or existing integration results');
const tests = selected.length
  ? selected
  : iosTestInventory(profile, process.env.OROT_IOS_TEST_SUITE ?? 'all');
const backupSelection = tests.some((test) => test.includes('/BackupPersistenceUITests/'));
const fixtureProfiles = ['fixtures', 'health-import', 'microphone', 'provider-selection'];
const fixtureSelection = fixtureProfiles.find((candidate) =>
  tests.some((test) => iosTestInventory(candidate).includes(test)),
);
const hostPreparation = isIosHostPreparation(tests, process.env.OROT_IOS_TEST_PHASE);
const fixtureSession = /^[a-f0-9-]{36}$/i.test(
  process.env.TEST_RUNNER_OROT_IOS_FIXTURE_SESSION ?? '',
);
const sharedPersistence = process.env.OROT_IOS_SHARED_PERSISTENCE_PHASE !== undefined;
if (sharedPersistence) verifySharedPersistenceSelection(profile, tests, process.env);
if (!sharedPersistence && tests.some((test) => statePersistenceTests.includes(test))) {
  const index = statePersistencePhases.indexOf(process.env.OROT_IOS_STATE_PHASE);
  if (
    profile !== 'core' ||
    tests.length !== 1 ||
    index < 0 ||
    tests[0] !== statePersistenceTests[index] ||
    !process.env.TEST_RUNNER_OROT_STATE_FIXTURE ||
    !process.env.TEST_RUNNER_OROT_STATE_MEMORY_FIXTURE ||
    (index > 0 && !process.env.TEST_RUNNER_OROT_STATE_PREVIOUS_PIDS)
  )
    throw new Error(
      'State persistence requires its host-orchestrated fresh-install and new-process phases',
    );
}
if (!sharedPersistence && tests.some((test) => recordingPersistenceTests.includes(test))) {
  const phase = process.env.OROT_IOS_RECORDING_PHASE;
  const expected =
    phase === 'seed'
      ? recordingPersistenceTests[0]
      : phase === 'read'
        ? recordingPersistenceTests[1]
        : null;
  if (
    profile !== 'core' ||
    tests.length !== 1 ||
    tests[0] !== expected ||
    (phase === 'read' && !process.env.TEST_RUNNER_OROT_RECORDING_BASELINE)
  )
    throw new Error('Recording persistence requires its host-orchestrated new-process phases');
}
if (tests.some((test) => fixtureIsolationTests.includes(test))) {
  const phase = process.env.OROT_IOS_FIXTURE_PHASE;
  const expected =
    phase === 'seed'
      ? fixtureIsolationTests[0]
      : phase === 'verify'
        ? fixtureIsolationTests[1]
        : null;
  if (
    profile !== 'core' ||
    tests.length !== 1 ||
    tests[0] !== expected ||
    !process.env.TEST_RUNNER_OROT_FIXTURE_TOKEN ||
    (phase === 'verify' && !process.env.TEST_RUNNER_OROT_FIXTURE_BASELINE)
  )
    throw new Error(
      'Fixture isolation requires its host-orchestrated contamination and reset phases',
    );
}
if (tests.some((test) => speechJourneyTests.includes(test))) {
  const phase = process.env.OROT_IOS_SPEECH_PHASE;
  const expected =
    phase === 'ui' ? speechJourneyTests[0] : phase === 'readback' ? speechJourneyTests[1] : null;
  if (
    profile !== 'speech' ||
    tests.length !== 1 ||
    tests[0] !== expected ||
    (phase === 'readback' && !process.env.TEST_RUNNER_OROT_SPEECH_BASELINE)
  )
    throw new Error('Speech UI and persistence require their host-orchestrated new-process phases');
}
if (
  (profile === 'backup' &&
    !hostPreparation &&
    (fixtureSession
      ? !selected.length ||
        new Set(tests).size !== tests.length ||
        tests.some((test) => !backupTests.slice(0, 3).includes(test))
      : tests.length !== 1 || !iosTestInventory('backup').includes(tests[0]))) ||
  (backupSelection && profile !== 'backup')
)
  throw new Error(
    'Backup cases require isolated host-orchestrated phases on the backup destination',
  );
if (
  (fixtureProfiles.includes(profile) &&
    !hostPreparation &&
    (!selected.length ||
      new Set(tests).size !== tests.length ||
      (!fixtureSession && selected.length !== 1) ||
      tests.some((test) => !iosTestInventory(profile).includes(test)))) ||
  (fixtureSelection && profile !== fixtureSelection)
)
  throw new Error('Fresh fixture cases require their dedicated host-orchestrated destination');
if (
  (profile === 'local-model' &&
    (selected.length !== 1 || !iosTestInventory(profile).includes(tests[0]))) ||
  (tests.some((test) => iosTestInventory('local-model').includes(test)) &&
    profile !== 'local-model')
)
  throw new Error('Local model cases require their isolated corpus and process phases');
if (
  tests.some(
    (test) =>
      !new RegExp(
        `^(${spec.integrationTarget}|${spec.uiTarget})/[A-Za-z0-9_]+/[A-Za-z0-9_]+$`,
      ).test(test),
  )
)
  throw new Error('Invalid integration test selection');
// Different targets have separate sandboxes, so the host must verify one before scheduling the other.
if (new Set(tests.map((test) => test.split('/')[0])).size !== 1)
  throw new Error('iOS and UI targets require separate verified invocations');
// A single destination and worker avoid test-runner clones and retries concealing the first result.
// Keep the pre-test process baseline, but skip periodic scans while XCTest is running.
const stopSampling = await iosTestResourceSampler(resolve(results) + '.resources.jsonl', {
  skipDuringProcessSnapshot: true,
});
const stopDiagnostics =
  profile === 'speech' && tests.some((test) => test.includes('/SpeechAssetPreparationTests/'))
    ? startIosSpeechDiagnostics(owner.udid, resolve(results) + '.speech-system.log')
    : async () => {};
const stopAuthDiagnostics =
  profile === 'provider-selection' && tests.includes(authDiagnosticTest)
    ? startIosAuthDiagnostics(owner.udid, resolve(results) + '.auth.jsonl')
    : async () => {};
const started = Date.now();
let testStageSucceeded = false;
const outcome = spawn(
  'xcodebuild',
  [
    'test-without-building',
    '-xctestrun',
    resolve(runFile),
    '-destination',
    'platform=iOS Simulator,id=' + owner.udid,
    '-resultBundlePath',
    resolve(results),
    '-parallel-testing-enabled',
    'NO',
    '-maximum-concurrent-test-simulator-destinations',
    '1',
    '-disableAutomaticPackageResolution',
    // Case duration is not an assertion; the owning job retains cancellation authority.
    '-test-timeouts-enabled',
    'NO',
    // Xcode's verbose simctl diagnose stalled for its full 600-second collection
    // budget after a failed assertion. Preserve xcresult/screenshots and collect
    // a bounded app log below; product recognition cancellation remains unchanged.
    '-collect-test-diagnostics',
    'never',
    ...tests.map((test) => '-only-testing:' + test),
  ],
  {
    stdio: 'inherit',
    // Xcode forwards this public prefix to the runner, including its automatic restart after a crash.
    env: { ...process.env, TEST_RUNNER_OROT_IOS_TEST_INVOCATION: randomUUID() },
  },
);
try {
  const status = await new Promise((resolveStatus, reject) => {
    outcome.once('error', reject);
    outcome.once('exit', (code, signal) => resolveStatus(signal ? 1 : (code ?? 1)));
  });
  testStageSucceeded = status === 0;
  await stopDiagnostics();
  await stopAuthDiagnostics();
  if (status !== 0) {
    const diagnostic = spawnSync(
      'xcrun',
      [
        'simctl',
        'spawn',
        owner.udid,
        'log',
        'show',
        '--style',
        'compact',
        '--last',
        '5m',
        '--predicate',
        'process == "Orot" AND (subsystem == "com.facebook.react.log" OR eventMessage CONTAINS "OROT_SPEECH")',
      ],
      { encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 },
    );
    writeFileSync(
      resolve(results) + '.app.log',
      [
        diagnostic.stdout ?? '',
        diagnostic.stderr ?? '',
        diagnostic.error ? 'Diagnostic unavailable: ' + String(diagnostic.error) : '',
      ].join('\n'),
    );
  }
  console.log(`IOS_TEST_STAGE elapsed_ms=${Date.now() - started} exit=${status}`);
  process.exitCode = status;
} finally {
  await stopDiagnostics();
  await stopAuthDiagnostics();
  // Keep terminal process evidence after a test failure; successful XCTest needs no extra scan.
  await stopSampling({ skipFinalProcessSnapshot: testStageSucceeded });
}
