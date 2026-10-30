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
  configuration: 'Release',
  entry: 'index.js',
  orotTests: false,
  testingEnvironment: {},
};

test('destination contract selects one UI case and never installs a target app', () => {
  validateProductionInputs(input);
  const run = productionTestRun(input);
  assert.equal(run.OrotUITests.UseDestinationArtifacts, true);
  assert.equal(run.OrotUITests.TestHostBundleIdentifier, input.runnerId);
  assert.equal(run.OrotUITests.TestBundleDestinationRelativePath, input.bundlePath);
  assert.equal(run.OrotUITests.UITargetAppBundleIdentifier, input.appId);
  for (const field of [
    'TestHostPath',
    'TestBundlePath',
    'UITargetAppPath',
    'DependentProductPaths',
    'CommandLineArguments',
  ])
    assert.equal(field in run.OrotUITests, false);
  assert.deepEqual(run.OrotUITests.OnlyTestIdentifiers, [
    'ProductionRagConversationUITests/testProductionConversation',
  ]);
});

test('runner must expose the named test class and method', () => {
  const symbols = 'OrotUITests32ProductionRagConversationUITests';
  const names = 'testProductionConversationAndReturnError:';
  assert.doesNotThrow(() => verifyProductionTestSymbols(symbols, names));
  assert.throws(() => verifyProductionTestSymbols(symbols, ''));
  assert.throws(() => verifyProductionTestSymbols('', names));
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
    { configuration: 'Debug' },
    { entry: 'e2e/testEntry.tsx' },
    { orotTests: true },
    { udid: 'booted' },
    { binaryHash: '' },
    { bundleId: '' },
  ])
    assert.throws(() => validateProductionInputs({ ...input, ...patch }));
});
