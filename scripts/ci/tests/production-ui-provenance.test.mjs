import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { verifyProductionProvenance } from '../production-ui-provenance.mjs';

const digest = (text) => createHash('sha256').update(text).digest('hex');
const settings = JSON.stringify([
  {
    target: 'OrotMobile',
    buildSettings: {
      CONFIGURATION: 'Release',
      PLATFORM_NAME: 'iphonesimulator',
      SWIFT_ACTIVE_COMPILATION_CONDITIONS: '',
      OTHER_SWIFT_FLAGS: '',
      GCC_PREPROCESSOR_DEFINITIONS: '',
    },
  },
]);
const log =
  'xcodebuild -scheme OrotMobile -configuration Release -sdk iphonesimulator build\nexport ENTRY_FILE=index.js\n** BUILD SUCCEEDED **\n';
const receipt = {
  sourceSha: 'a'.repeat(40),
  sourceClean: true,
  binarySha: 'b'.repeat(64),
  jsBundleSha: 'c'.repeat(64),
  logSha: digest(log),
  settingsSha: digest(settings),
  argv: [
    'xcodebuild',
    'build',
    '-scheme',
    'OrotMobile',
    '-configuration',
    'Release',
    '-sdk',
    'iphonesimulator',
  ],
  entryFile: null,
};

test('matches production evidence to the installed binary and rejects absent or mismatched evidence', () => {
  assert.equal(
    verifyProductionProvenance(receipt, settings, log, 'b'.repeat(64), 'c'.repeat(64)).sourceSha,
    receipt.sourceSha,
  );
  for (const patch of [
    { sourceSha: '' },
    { binarySha: 'c'.repeat(64) },
    { jsBundleSha: '' },
    { logSha: '' },
    { entryFile: 'e2e/testEntry.tsx' },
    { argv: ['xcodebuild', 'build', '-configuration', 'Debug'] },
  ])
    assert.throws(() =>
      verifyProductionProvenance(
        { ...receipt, ...patch },
        settings,
        log,
        'b'.repeat(64),
        'c'.repeat(64),
      ),
    );
  assert.throws(() =>
    verifyProductionProvenance(receipt, settings, log + 'modified', 'b'.repeat(64), 'c'.repeat(64)),
  );
});

test('rejects a Release setting with a fixture compiler flag', () => {
  const altered = settings.replace('"OTHER_SWIFT_FLAGS":""', '"OTHER_SWIFT_FLAGS":"-DOROT_TESTS"');
  assert.throws(() =>
    verifyProductionProvenance(
      { ...receipt, settingsSha: digest(altered) },
      altered,
      log,
      'b'.repeat(64),
      'c'.repeat(64),
    ),
  );
});

test('rejects an installed JavaScript bundle that differs from the producer receipt', () => {
  assert.throws(() =>
    verifyProductionProvenance(receipt, settings, log, 'b'.repeat(64), 'd'.repeat(64)),
  );
});
