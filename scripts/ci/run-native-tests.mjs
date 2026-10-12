import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { nativeTestConfig, representativeSpeechTests } from './native-test-config.mjs';
import { verifyNativeSimulator } from './native-test-simulator.mjs';
import { nativeResourceSampler } from './native-test-resources.mjs';

const [profile, runFile, ownerFile, results, ...selected] = process.argv.slice(2);
if (!results)
  throw new Error(
    'Usage: run-native-tests.mjs <profile> <xctestrun> <owner-file> <xcresult> [test-identifiers]',
  );
const spec = nativeTestConfig(profile);
const owner = JSON.parse(readFileSync(ownerFile, 'utf8'));
if (verifyNativeSimulator(owner, profile).state !== 'Booted')
  throw new Error('Native tests require their booted owned simulator');
if (!existsSync(runFile) || existsSync(results))
  throw new Error('Missing products or existing native results');
const tests = selected.length ? selected : profile === 'speech' ? representativeSpeechTests : [];
if (
  tests.some(
    (test) =>
      !new RegExp(`^(${spec.nativeTarget}|${spec.uiTarget})/[A-Za-z0-9_]+/[A-Za-z0-9_]+$`).test(
        test,
      ),
  )
)
  throw new Error('Invalid native test selection');
// A single destination and worker avoid test-runner clones and retries concealing the first result.
const stopSampling = nativeResourceSampler(resolve(results) + '.resources.jsonl');
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
    ...tests.map((test) => '-only-testing:' + test),
  ],
  { stdio: 'inherit' },
);
try {
  const status = await new Promise((resolveStatus, reject) => {
    outcome.once('error', reject);
    outcome.once('exit', (code, signal) => resolveStatus(signal ? 1 : (code ?? 1)));
  });
  console.log(`NATIVE_TEST_STAGE elapsed_ms=${Date.now() - started} exit=${status}`);
  process.exitCode = status;
} finally {
  stopSampling();
}
