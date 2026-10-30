import test from 'node:test';
import assert from 'node:assert/strict';
import {
  productionTestRun,
  productionTestingEnvironment,
  verifyProductionTestSymbols,
  validateProductionInputs,
} from '../production-ui-contract.mjs';
import { iosTestInventory } from '../ios-test-inventory.mjs';

const input = {
  udid: '12345678-1234-1234-1234-123456789ABC',
  appId: 'com.orot.mobile',
  runnerId: 'com.orot.mobile.OrotUITests.xctrunner',
  bundleId: 'com.orot.mobile.OrotUITests',
  bundlePath: '__TESTHOST__/PlugIns/OrotUITests.xctest',
  binaryHash: 'a'.repeat(64),
  installedHash: 'a'.repeat(64),
  jsBundleHash: 'b'.repeat(64),
  installedJsBundleHash: 'b'.repeat(64),
  configuration: 'Release',
  entry: 'index.js',
  orotTests: false,
  productionAppPath: '/verified/Orot.app',
  runnerPath: '/verified/OrotUITests-Runner.app',
  testingEnvironment: {},
};

test('Simulator contract selects only the verified production app and runner products', () => {
  validateProductionInputs(input);
  const run = productionTestRun(input);
  assert.equal(run.OrotUITests.TestHostPath, input.runnerPath);
  assert.equal(run.OrotUITests.TestBundlePath, input.bundlePath);
  assert.equal(run.OrotUITests.UITargetAppPath, input.productionAppPath);
  assert.deepEqual(run.OrotUITests.DependentProductPaths, [
    input.productionAppPath,
    input.runnerPath,
    `${input.runnerPath}/PlugIns/OrotUITests.xctest`,
  ]);
  assert.equal(run.OrotUITests.TestHostBundleIdentifier, input.runnerId);
  for (const field of [
    'UseDestinationArtifacts',
    'TestBundleDestinationRelativePath',
    'UITargetAppBundleIdentifier',
    'CommandLineArguments',
  ])
    assert.equal(field in run.OrotUITests, false);
  assert.deepEqual(run.OrotUITests.OnlyTestIdentifiers, [
    'ProductionRagConversationUITests/testProductionConversation',
  ]);
});

test('explicit cancellation probe selects only a no-Send case with bounded runner configuration', () => {
  const probe = { port: 12345, token: '11111111-1111-4111-8111-111111111111' };
  const run = productionTestRun(input, probe);
  assert.deepEqual(run.OrotUITests.OnlyTestIdentifiers, [
    'ProductionRagConversationUITests/testProductionCancellationBeforeSend',
  ]);
  assert.deepEqual(run.OrotUITests.TestingEnvironmentVariables, {
    OROT_PRODUCTION_CANCEL_PORT: '12345',
    OROT_PRODUCTION_CANCEL_TOKEN: probe.token,
  });
  assert.throws(() => productionTestRun(input, { ...probe, port: 0 }));
  assert.throws(() => productionTestRun(input, { ...probe, token: 'invalid' }));
});

test('runner must expose the named test class and method', () => {
  const symbols = 'OrotUITests32ProductionRagConversationUITests';
  const names = 'testProductionConversationAndReturnError:';
  assert.doesNotThrow(() => verifyProductionTestSymbols(symbols, names));
  assert.throws(() => verifyProductionTestSymbols(symbols, ''));
  assert.throws(() => verifyProductionTestSymbols('', names));
  assert.throws(() => verifyProductionTestSymbols(symbols, names, true));
  assert.doesNotThrow(() =>
    verifyProductionTestSymbols(
      symbols,
      names + '\ntestProductionCancellationBeforeSendWithCompletionHandler:',
      true,
    ),
  );
});

test('Xcode runner environment rejects injected variables and resolves only its products root', () => {
  const root = '__TESTROOT__/Release-iphonesimulator';
  const env = {
    __XPC_DYLD_LIBRARY_PATH: root,
    XCODE_SCHEME_NAME: 'OrotTests',
    __XPC_DYLD_FRAMEWORK_PATH: root,
    DYLD_FRAMEWORK_PATH: `${root}:${root}/PackageFrameworks:__PLATFORMS__/iPhoneSimulator.platform/Developer/Library/Frameworks`,
    __XCODE_BUILT_PRODUCTS_DIR_PATHS: root,
    DYLD_LIBRARY_PATH: `${root}:__PLATFORMS__/iPhoneSimulator.platform/Developer/usr/lib`,
  };
  assert.equal(
    productionTestingEnvironment(env, '/products').__XPC_DYLD_LIBRARY_PATH,
    '/products/Release-iphonesimulator',
  );
  assert.throws(() =>
    productionTestingEnvironment({ ...env, OROT_TEST_SCENARIO: 'fixture' }, '/products'),
  );
});

test('production case is absent from default core and Duo selection', () => {
  const selected = 'OrotUITests/ProductionRagConversationUITests/testProductionConversation';
  assert.equal(iosTestInventory('core').includes(selected), false);
  assert.equal(iosTestInventory('duo').includes(selected), false);
});

test('rejects fixture products, identity mismatches, malformed destinations and missing provenance', () => {
  for (const patch of [
    { appId: 'com.orot.fixture' },
    { runnerId: 'com.orot.mobile' },
    { bundlePath: '__TESTHOST__/../Orot.app' },
    { installedHash: 'b'.repeat(64) },
    { installedJsBundleHash: 'c'.repeat(64) },
    { configuration: 'Debug' },
    { entry: 'e2e/testEntry.tsx' },
    { orotTests: true },
    { udid: 'booted' },
    { binaryHash: '' },
    { bundleId: '' },
  ])
    assert.throws(() => validateProductionInputs({ ...input, ...patch }));
});
