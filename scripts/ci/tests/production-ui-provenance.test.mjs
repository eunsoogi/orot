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
      OTHER_SWIFT_FLAGS: '',
      GCC_PREPROCESSOR_DEFINITIONS: '',
    },
  },
]);
const responsePath = '/tmp/derived/Build/Intermediates.noindex/Orot.SwiftFileList';
const response = '/tmp/source/AppDelegate.swift\n/tmp/source/AppleFoundationModelsSession.swift\n';
const command = `/Applications/Xcode.app/usr/bin/swiftc -module-name Orot -target arm64-apple-ios27.1-simulator @${responsePath} -D COCOAPODS -Xfrontend -serialize-debugging-options`;
const target = "(in target 'OrotMobile' from project 'OrotMobile')";
const headers = [
  ['SwiftDriver', 'builtin-SwiftDriver'],
  ['SwiftDriver\\ Compilation\\ Requirements', 'builtin-Swift-Compilation-Requirements'],
  ['SwiftDriver\\ Compilation', 'builtin-Swift-Compilation'],
];
const driver = headers
  .map(
    ([header, wrapper]) =>
      `${header} OrotMobile normal arm64 com.apple.xcode.tools.swift.compiler ${target}\n    cd /tmp/source\n    ${wrapper} -- ${command}`,
  )
  .join('\n');
const log =
  [
    'xcodebuild -scheme OrotMobile -configuration Release -sdk iphonesimulator build',
    'export ENTRY_FILE=index.js',
    driver,
    `SwiftCompile normal arm64 /tmp/source/AppDelegate.swift ${target}`,
    `SwiftCompile normal arm64 /tmp/source/AppleFoundationModelsSession.swift ${target}`,
    '+ /usr/bin/node /node/react-native/scripts/bundle.js bundle --entry-file index.js --platform ios --dev false --bundle-output /tmp/derived/Build/Products/Release-iphonesimulator/main.jsbundle --assets-dest /tmp/derived/Build/Products/Release-iphonesimulator/Orot.app',
    '+ /tools/hermesc -out /tmp/derived/Build/Products/Release-iphonesimulator/Orot.app/main.jsbundle /tmp/derived/Build/Products/Release-iphonesimulator/main.jsbundle',
    '** BUILD SUCCEEDED **',
  ].join('\n') + '\n';
const receipt = {
  sourceSha: 'a'.repeat(40),
  sourceClean: true,
  binarySha: 'b'.repeat(64),
  jsBundleSha: 'c'.repeat(64),
  logSha: digest(log),
  settingsSha: digest(settings),
  swiftResponsePath: responsePath,
  swiftResponseSha: digest(response),
  swiftResponseBeforeSha: digest(response),
  swiftResponseAfterSha: digest(response),
  captureStartedAt: '2026-10-30T00:00:00.000Z',
  captureEndedAt: '2026-10-30T00:01:00.000Z',
  responseCapturedDuringBuild: true,
  argv: [
    '-workspace',
    'apps/mobile/ios/OrotMobile.xcworkspace',
    '-scheme',
    'OrotMobile',
    '-configuration',
    'Release',
    '-sdk',
    'iphonesimulator',
    '-destination',
    'generic/platform=iOS Simulator',
    '-derivedDataPath',
    '/tmp/derived',
    'ARCHS=arm64',
  ],
  entryFile: 'index.js',
};
const verify = (
  proof = receipt,
  actualSettings = settings,
  actualLog = log,
  actualResponse = response,
  js = 'c'.repeat(64),
) =>
  verifyProductionProvenance(proof, actualSettings, actualLog, 'b'.repeat(64), js, actualResponse);

test('accepts captured compiler evidence even when the settings key is omitted', () => {
  assert.equal(verify().sourceSha, receipt.sourceSha);
  assert.equal(
    verify({ ...receipt, captureEndedAt: receipt.captureStartedAt }).sourceSha,
    receipt.sourceSha,
  );
  assert.equal(
    verify({ ...receipt, argv: ['xcodebuild', ...receipt.argv, 'build'] }).sourceSha,
    receipt.sourceSha,
  );
  assert.throws(() => verify(receipt, settings, log, null));
});

test('accepts a captured Swift source path containing a plus character', () => {
  const captured = response + '/tmp/source/RecordingModule+Commands.swift\n';
  const sha = digest(captured);
  assert.equal(
    verify(
      {
        ...receipt,
        swiftResponseSha: sha,
        swiftResponseBeforeSha: sha,
        swiftResponseAfterSha: sha,
      },
      settings,
      log,
      captured,
    ).sourceSha,
    receipt.sourceSha,
  );
});

test('rejects missing or mismatched producer, product, and response evidence', () => {
  for (const patch of [
    { sourceSha: '' },
    { sourceClean: false },
    { binarySha: 'd'.repeat(64) },
    { jsBundleSha: '' },
    { logSha: '' },
    { responseCapturedDuringBuild: false },
    { swiftResponsePath: '/tmp/other/Orot.SwiftFileList' },
    { swiftResponseSha: '' },
    { swiftResponseAfterSha: '' },
    { captureEndedAt: '' },
    { captureEndedAt: '2026-10-29T23:59:00.000Z' },
    { captureEndedAt: '2026-10-29T23:59:59.999Z' },
    { captureStartedAt: '2026-13-30T00:00:00.000Z' },
    { captureEndedAt: receipt.captureStartedAt, responseCapturedDuringBuild: false },
    { captureEndedAt: receipt.captureStartedAt, swiftResponseAfterSha: 'd'.repeat(64) },
    { entryFile: 'e2e/testEntry.tsx' },
    { argv: [...receipt.argv, 'clean'] },
  ])
    assert.throws(() => verify({ ...receipt, ...patch }));
  assert.throws(() => verify(receipt, settings, log + 'changed'));
  assert.throws(() => verify(receipt, settings, log, response, 'd'.repeat(64)));
  assert.throws(() => verify(receipt, settings, log, response + '@nested\n'));
});

test('rejects unsupported source settings and indirect compiler inputs', () => {
  const badSettings = settings.replace(
    '"OTHER_SWIFT_FLAGS":""',
    '"OTHER_SWIFT_FLAGS":"-DOROT_TESTS"',
  );
  assert.throws(() => verify({ ...receipt, settingsSha: digest(badSettings) }, badSettings));
  for (const badResponse of [
    response + '@nested\n',
    response + '-DOROT_TESTS\n',
    response + '/tmp/source/Bad Name.swift\n',
    response + '/tmp/source/../Other.swift\n',
    '/tmp/source/AppDelegate.swift\n',
  ])
    assert.throws(() =>
      verify(
        {
          ...receipt,
          swiftResponseSha: digest(badResponse),
          swiftResponseBeforeSha: digest(badResponse),
          swiftResponseAfterSha: digest(badResponse),
        },
        settings,
        log,
        badResponse,
      ),
    );
});

test('rejects conflicting or unsupported compiler records and unexecuted bundling', () => {
  for (const altered of [
    log.replace('normal arm64', 'normal x86_64'),
    log.replace(command, command + ' -D OROT_TESTS'),
    log.replaceAll(command, command + ' -Xfrontend -load-plugin-library'),
    log.replaceAll(command, command + ' @/tmp/extra'),
    log.replaceAll(command, command + ' -filelist /tmp/extra'),
    log.replace(
      '** BUILD SUCCEEDED **',
      `SwiftDriver OrotMobile normal x86_64 compiler ${target}\n** BUILD SUCCEEDED **`,
    ),
    log.replace(
      'SwiftCompile normal arm64 /tmp/source/AppDelegate.swift',
      'SkippedCompile normal arm64 /tmp/source/AppDelegate.swift',
    ),
    log.replace(
      '--entry-file index.js --platform ios --dev false',
      '--entry-file fixture.js --platform ios --dev false',
    ),
    log.replace('--entry-file index.js', '--entry-file index.js --entry-file fixture.js'),
    log.replace('/tools/hermesc -out', '/tools/echo -out'),
  ])
    assert.throws(() => verify({ ...receipt, logSha: digest(altered) }, settings, altered));
});

test('accepts ordinary Xcode SwiftDriver job discovery records', () => {
  const discovery = `SwiftDriverJobDiscovery normal arm64 Compiling bridging header ${target}`;
  const observed = log.replace('** BUILD SUCCEEDED **', discovery + '\n** BUILD SUCCEEDED **');
  assert.doesNotThrow(() => verify({ ...receipt, logSha: digest(observed) }, settings, observed));
});
