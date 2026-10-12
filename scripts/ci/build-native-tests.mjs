import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { nativeBuildSpec } from './native-test-config.mjs';
import { productContext } from './native-product-context.mjs';

const [profile, directory] = process.argv.slice(2);
if (!directory) throw new Error('Usage: build-native-tests.mjs <profile> <derived-data>');
const spec = nativeBuildSpec(profile);
if (process.env.GITHUB_ACTIONS === 'true') productContext(process.cwd(), profile);
// Generic build products have no simulator dependency. Consumers boot only after verification.
const result = spawnSync(
  'xcodebuild',
  [
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
if (result.error) throw result.error;
process.exit(result.status ?? 1);
