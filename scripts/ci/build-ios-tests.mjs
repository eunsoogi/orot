import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolve } from 'node:path';
import { iosTestBuildSpec } from './ios-test-config.mjs';
import { productContext } from './ios-test-product-context.mjs';
import { iosTestResourceSampler } from './ios-test-resources.mjs';

const [profile, directory] = process.argv.slice(2);
if (!directory) throw new Error('Usage: build-ios-tests.mjs <profile> <derived-data>');
const spec = iosTestBuildSpec(profile);
if (process.env.GITHUB_ACTIONS === 'true') productContext(process.cwd(), profile);
// Generic build products have no simulator dependency. Consumers boot only after verification.
mkdirSync(dirname(resolve(directory)), { recursive: true });
const stopSampling = await iosTestResourceSampler(resolve(directory) + '.resources.jsonl');
const started = Date.now();
// Keep Xcode diagnostics visible and fail product generation when a warning appears.
const result = spawn(
  process.execPath,
  [
    'scripts/ci/fail-on-warning.mjs',
    '--',
    'xcodebuild',
    'build-for-testing',
    '-quiet',
    '-jobs',
    '3',
    '-workspace',
    'apps/mobile/ios/OrotMobile.xcworkspace',
    '-scheme',
    spec.scheme,
    '-configuration',
    spec.configuration,
    '-sdk',
    'iphonesimulator',
    '-destination',
    'generic/platform=iOS Simulator',
    '-derivedDataPath',
    resolve(directory),
    'ARCHS=' + spec.architecture,
    'ONLY_ACTIVE_ARCH=YES',
    'ENABLE_TESTABILITY=' + spec.testability,
    'OTHER_SWIFT_FLAGS=' + spec.compilerFlags,
    'GCC_PREPROCESSOR_DEFINITIONS=' + spec.preprocessorFlags,
    'CODE_SIGNING_ALLOWED=' + spec.signing.allowed,
    'CODE_SIGN_IDENTITY=' + spec.signing.identity,
    'DEVELOPMENT_TEAM=' + spec.signing.team,
  ],
  { stdio: 'inherit', env: { ...process.env, FORCE_BUNDLING: '1', ENTRY_FILE: spec.entry } },
);
try {
  const status = await new Promise((resolveStatus, reject) => {
    result.once('error', reject);
    result.once('exit', (code, signal) => resolveStatus(signal ? 1 : (code ?? 1)));
  });
  console.log(`IOS_BUILD_STAGE elapsed_ms=${Date.now() - started} exit=${status}`);
  process.exitCode = status;
} finally {
  await stopSampling();
}
