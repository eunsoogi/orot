import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { iosTestConfig } from './ios-test-config.mjs';
import { iosTestInventory } from './ios-test-inventory.mjs';
import { verifyIosTestSimulator } from './ios-test-simulator.mjs';
import { iosTestResourceSampler } from './ios-test-resources.mjs';
import { isIosHostPreparation } from './ios-test-preparation-contract.mjs';

const [profile, runFile, ownerFile, results, ...selected] = process.argv.slice(2);
if (!results)
  throw new Error(
    'Usage: run-ios-tests.mjs <profile> <xctestrun> <owner-file> <xcresult> [test-identifiers]',
  );
const spec = iosTestConfig(profile);
const owner = JSON.parse(readFileSync(ownerFile, 'utf8'));
if (verifyIosTestSimulator(owner, profile).state !== 'Booted')
  throw new Error('Native tests require their booted owned simulator');
if (!existsSync(runFile) || existsSync(results))
  throw new Error('Missing products or existing native results');
const tests = selected.length
  ? selected
  : iosTestInventory(profile, process.env.OROT_IOS_TEST_SUITE ?? 'all');
const backupSelection = tests.some((test) => test.includes('/BackupPersistenceUITests/'));
const fixtureSelection = tests.some((test) => iosTestInventory('fixtures').includes(test));
const hostPreparation = isIosHostPreparation(tests, process.env.OROT_IOS_TEST_PHASE);
if (
  (profile === 'backup' &&
    !hostPreparation &&
    (tests.length !== 1 || !iosTestInventory('backup').includes(tests[0]))) ||
  (backupSelection && profile !== 'backup')
)
  throw new Error(
    'Backup cases require isolated host-orchestrated phases on the backup destination',
  );
if (
  (profile === 'fixtures' &&
    !hostPreparation &&
    (selected.length !== 1 || !iosTestInventory(profile).includes(tests[0]))) ||
  (fixtureSelection && profile !== 'fixtures')
)
  throw new Error('Fresh fixture cases require their dedicated host-orchestrated destination');
if (
  tests.some(
    (test) =>
      !new RegExp(
        `^(${spec.integrationTarget}|${spec.uiTarget})/[A-Za-z0-9_]+/[A-Za-z0-9_]+$`,
      ).test(test),
  )
)
  throw new Error('Invalid native test selection');
// A single destination and worker avoid test-runner clones and retries concealing the first result.
const stopSampling = iosTestResourceSampler(resolve(results) + '.resources.jsonl');
const started = Date.now();
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
    // Xcode's verbose simctl diagnose stalled for its full 600-second collection
    // budget after a failed assertion. Preserve xcresult/screenshots and collect
    // a bounded app log below; recognition and assertion deadlines are unchanged.
    '-collect-test-diagnostics',
    'never',
    ...tests.map((test) => '-only-testing:' + test),
  ],
  { stdio: 'inherit' },
);
try {
  const status = await new Promise((resolveStatus, reject) => {
    outcome.once('error', reject);
    outcome.once('exit', (code, signal) => resolveStatus(signal ? 1 : (code ?? 1)));
  });
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
  stopSampling();
}
