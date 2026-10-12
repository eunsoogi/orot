import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { verifyIosTestSimulator } from './ios-test-simulator.mjs';
import { hostConnectionTest } from './ios-test-preparation-contract.mjs';
import { verifyIosTestResults } from './ios-test-results.mjs';

const [profile, runFile, ownerFile, directory] = process.argv.slice(2);
if (!directory || process.env.GITHUB_ACTIONS !== 'true')
  throw new Error('Simulator UI preparation requires its hosted Actions execution');
const owner = JSON.parse(readFileSync(ownerFile, 'utf8'));
if (
  !/^[a-f0-9-]{36}$/i.test(owner.udid) ||
  verifyIosTestSimulator(owner, profile).state !== 'Booted'
)
  throw new Error('Simulator UI preparation requires its booted owned destination');
const evidence = resolve(directory);
mkdirSync(evidence, { recursive: true });
const metadata = resolve(evidence, 'ui-bootstrap.json');
if (existsSync(metadata)) throw new Error('Existing Simulator UI preparation evidence');
const started = Date.now();
const developer = process.env.DEVELOPER_DIR;
if (!developer || !isAbsolute(developer))
  throw new Error('Simulator UI preparation requires the explicit selected Xcode directory');
// Core's native-first executions reached XCUI while cold standalone UI runners failed before their cases.
// Exercise the same real app-host/JS boundary as a separate preparation result, without another boot or retry.
const nativeResult = resolve(evidence, 'host-preparation.xcresult');
execFileSync(
  'scripts/ci/run-command.sh',
  [
    'ios-host-preparation',
    resolve(evidence, 'host-preparation.log'),
    '--',
    process.execPath,
    'scripts/ci/run-ios-tests.mjs',
    profile,
    runFile,
    ownerFile,
    nativeResult,
    hostConnectionTest,
  ],
  { stdio: 'inherit', env: { ...process.env, OROT_IOS_TEST_PHASE: 'prepare-ui' } },
);
const report = JSON.parse(
  execFileSync(
    'xcrun',
    ['xcresulttool', 'get', 'test-results', 'tests', '--path', nativeResult, '--compact'],
    { encoding: 'utf8' },
  ),
);
const observations = verifyIosTestResults(report, [hostConnectionTest]);
writeFileSync(
  resolve(evidence, 'host-preparation.json'),
  JSON.stringify({ profile, observations }, null, 2) + '\n',
);
// Xcode 27 ships Device Hub. Its installed bundle is diagnostic information; no unsupported device-selection argument is sent.
const guiApplication = existsSync(resolve(developer, '../Applications/DeviceHub.app'))
  ? 'DeviceHub'
  : 'unavailable';
let screenshot = 'unavailable';
try {
  execFileSync(
    'xcrun',
    ['simctl', 'io', owner.udid, 'screenshot', resolve(evidence, 'initial-simulator.png')],
    { timeout: 30000 },
  );
  const bytes = readFileSync(resolve(evidence, 'initial-simulator.png'));
  if (
    bytes.length < 32 ||
    bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
    bytes.readUInt32BE(16) === 0 ||
    bytes.readUInt32BE(20) === 0
  )
    throw new Error('Simulator screenshot did not contain PNG image dimensions');
  screenshot = 'captured';
} catch {
  // A rendering diagnostic is optional; only subsequent real XCUI results can prove Accessibility initialized.
  console.log('IOS_UI_INITIAL_SCREEN unavailable');
}
writeFileSync(
  metadata,
  JSON.stringify(
    {
      profile,
      udid: owner.udid,
      hostConnectionVerified: true,
      guiApplication,
      targetedGuiLaunch: 'unsupported',
      selectedXcodeDeveloperDirectory: developer,
      screenshot,
      elapsedMs: Date.now() - started,
    },
    null,
    2,
  ) + '\n',
);
console.log(`IOS_UI_PREPARATION elapsed_ms=${Date.now() - started} screenshot=${screenshot}`);
