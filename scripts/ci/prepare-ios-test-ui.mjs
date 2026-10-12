import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { verifyIosTestSimulator } from './ios-test-simulator.mjs';

const [profile, ownerFile, directory] = process.argv.slice(2);
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
// Use the same selected Developer directory as product verification. A tool binary's location does not identify an application bundle.
const simulator = resolve(developer, 'Applications/Simulator.app');
if (!existsSync(simulator)) throw new Error('Selected Xcode Simulator application is unavailable');
// Request the matching Xcode UI for this destination after its single boot. No device or service is restarted.
execFileSync('open', [simulator, '--args', '-CurrentDeviceUDID', owner.udid], { timeout: 30000 });
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
      simulatorAppOpenRequested: true,
      selectedXcodeDeveloperDirectory: developer,
      screenshot,
      elapsedMs: Date.now() - started,
    },
    null,
    2,
  ) + '\n',
);
console.log(`IOS_UI_PREPARATION elapsed_ms=${Date.now() - started} screenshot=${screenshot}`);
