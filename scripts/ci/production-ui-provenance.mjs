import { createHash } from 'node:crypto';
import { verifyCompilerEvidence } from './production-ui-compiler-evidence.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');

/** Accept Xcode's default build action without inventing an argv token in the producer receipt. */
function validBuildArguments(argv) {
  if (!Array.isArray(argv) || argv.some((value) => typeof value !== 'string')) return false;
  const args = argv[0]?.endsWith('xcodebuild') ? argv.slice(1) : argv;
  const pairs = new Map();
  let build = false;
  let architecture = false;
  let condition = false;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === 'build' && !build) {
      build = true;
      continue;
    }
    if (value === 'ARCHS=arm64' && !architecture) {
      architecture = true;
      continue;
    }
    if (
      /^SWIFT_ACTIVE_COMPILATION_CONDITIONS=[A-Za-z0-9_ -]+$/.test(value) &&
      !/OROT_TESTS/i.test(value) &&
      !condition
    ) {
      condition = true;
      continue;
    }
    if (
      ![
        '-workspace',
        '-scheme',
        '-configuration',
        '-sdk',
        '-destination',
        '-derivedDataPath',
      ].includes(value) ||
      pairs.has(value) ||
      index + 1 >= args.length
    )
      return false;
    pairs.set(value, args[++index]);
  }
  return (
    architecture &&
    pairs.get('-workspace') === 'apps/mobile/ios/OrotMobile.xcworkspace' &&
    pairs.get('-scheme') === 'OrotMobile' &&
    pairs.get('-configuration') === 'Release' &&
    pairs.get('-sdk') === 'iphonesimulator' &&
    pairs.get('-destination') === 'generic/platform=iOS Simulator' &&
    /^\/[A-Za-z0-9_./-]+$/.test(pairs.get('-derivedDataPath') ?? '') &&
    !pairs.get('-derivedDataPath').split('/').includes('..')
  );
}

/** Match producer-supplied build evidence to the installed bytes; it does not authenticate its author. */
export function verifyProductionProvenance(
  receipt,
  settingsText,
  log,
  binarySha,
  jsBundleSha,
  response,
) {
  const argv = receipt?.argv;
  const validHash = (value, length) => new RegExp(`^[a-f0-9]{${length}}$`).test(value ?? '');
  if (
    !validHash(receipt?.sourceSha, 40) ||
    receipt.sourceClean !== true ||
    !validHash(receipt?.binarySha, 64) ||
    receipt.binarySha !== binarySha ||
    !validHash(receipt?.jsBundleSha, 64) ||
    receipt.jsBundleSha !== jsBundleSha ||
    !validHash(receipt?.logSha, 64) ||
    receipt.logSha !== digest(log) ||
    !validHash(receipt?.settingsSha, 64) ||
    receipt.settingsSha !== digest(settingsText) ||
    !validBuildArguments(argv) ||
    ![null, 'index.js'].includes(receipt.entryFile) ||
    !/\bENTRY_FILE=index\.js\b/.test(log) ||
    !/\bOrotMobile\b/.test(log) ||
    !/-configuration\s+Release\b/.test(log) ||
    !/-sdk\s+iphonesimulator\b/.test(log) ||
    !log.includes('** BUILD SUCCEEDED **')
  )
    throw new Error('Missing or mismatched production build evidence');
  const targets = JSON.parse(settingsText);
  const apps = targets.filter((target) => target.target === 'OrotMobile');
  const settings = apps[0]?.buildSettings;
  const flagNames = ['OTHER_SWIFT_FLAGS', 'GCC_PREPROCESSOR_DEFINITIONS'];
  if (
    apps.length !== 1 ||
    settings.CONFIGURATION !== 'Release' ||
    settings.PLATFORM_NAME !== 'iphonesimulator' ||
    (settings.SWIFT_ACTIVE_COMPILATION_CONDITIONS !== undefined &&
      (typeof settings.SWIFT_ACTIVE_COMPILATION_CONDITIONS !== 'string' ||
        /OROT_TESTS/.test(settings.SWIFT_ACTIVE_COMPILATION_CONDITIONS))) ||
    flagNames.some(
      (name) => typeof settings[name] !== 'string' || /OROT_TESTS/.test(settings[name]),
    )
  )
    throw new Error('Production build settings do not establish a non-fixture Release');
  verifyCompilerEvidence(receipt, log, response);
  return {
    sourceSha: receipt.sourceSha,
    binarySha: receipt.binarySha,
    jsBundleSha: receipt.jsBundleSha,
  };
}
