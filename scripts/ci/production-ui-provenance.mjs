import { createHash } from 'node:crypto';

const digest = (value) => createHash('sha256').update(value).digest('hex');

/** Match producer-supplied build evidence to the installed bytes; it does not authenticate its author. */
export function verifyProductionProvenance(receipt, settingsText, log, binarySha, jsBundleSha) {
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
    !Array.isArray(argv) ||
    argv.some((value) => typeof value !== 'string') ||
    !argv[0]?.endsWith('xcodebuild') ||
    !argv.includes('build') ||
    argv[argv.indexOf('-scheme') + 1] !== 'OrotMobile' ||
    argv[argv.indexOf('-configuration') + 1] !== 'Release' ||
    argv[argv.indexOf('-sdk') + 1] !== 'iphonesimulator' ||
    argv.some((value) => /OROT_TESTS|testEntry/i.test(value)) ||
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
  const flagNames = [
    'SWIFT_ACTIVE_COMPILATION_CONDITIONS',
    'OTHER_SWIFT_FLAGS',
    'GCC_PREPROCESSOR_DEFINITIONS',
  ];
  if (
    apps.length !== 1 ||
    settings.CONFIGURATION !== 'Release' ||
    settings.PLATFORM_NAME !== 'iphonesimulator' ||
    flagNames.some(
      (name) => typeof settings[name] !== 'string' || /OROT_TESTS/.test(settings[name]),
    )
  )
    throw new Error('Production build settings do not establish a non-fixture Release');
  return {
    sourceSha: receipt.sourceSha,
    binarySha: receipt.binarySha,
    jsBundleSha: receipt.jsBundleSha,
  };
}
