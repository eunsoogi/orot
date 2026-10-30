import { isDeepStrictEqual } from 'node:util';
import { isAbsolute, join } from 'node:path';

/** Production verification is an explicit route and is never part of fixture defaults. */
export const productionConversationTest =
  'OrotUITests/ProductionRagConversationUITests/testProductionConversation';
export const productionCancellationTest =
  'OrotUITests/ProductionRagConversationUITests/testProductionCancellationBeforeSend';
export const productionTestInventory = [productionConversationTest, productionCancellationTest];

/** Fail before installing a runner that cannot expose the selected XCTest case. */
export function verifyProductionTestSymbols(symbols, strings, probe = false) {
  if (
    !symbols.includes('OrotUITests32ProductionRagConversationUITests') ||
    !strings.includes('testProductionConversationAndReturnError:') ||
    (probe && !strings.includes('testProductionCancellationBeforeSendWithCompletionHandler:'))
  )
    throw new Error('Production conversation test is absent from the runner');
}

/** Preserve only the generated Xcode runner environment, rooted at the verified products. */
export function productionTestingEnvironment(environment, testRoot) {
  const root = '__TESTROOT__/Release-iphonesimulator';
  const expected = {
    __XPC_DYLD_LIBRARY_PATH: root,
    XCODE_SCHEME_NAME: 'OrotTests',
    __XPC_DYLD_FRAMEWORK_PATH: root,
    DYLD_FRAMEWORK_PATH: `${root}:${root}/PackageFrameworks:__PLATFORMS__/iPhoneSimulator.platform/Developer/Library/Frameworks`,
    __XCODE_BUILT_PRODUCTS_DIR_PATHS: root,
    DYLD_LIBRARY_PATH: `${root}:__PLATFORMS__/iPhoneSimulator.platform/Developer/usr/lib`,
  };
  if (
    !isDeepStrictEqual(environment, expected) ||
    typeof testRoot !== 'string' ||
    !testRoot.startsWith('/')
  )
    throw new Error('Unexpected Xcode runner environment');
  return Object.fromEntries(
    Object.entries(environment).map(([key, value]) => [
      key,
      value.replaceAll('__TESTROOT__', testRoot),
    ]),
  );
}

/** Bind Simulator installation to validated production and runner paths, never fixture products. */
export function productionTestRun(input, probe) {
  validateProductionInputs(input);
  if (
    probe &&
    (!Number.isInteger(probe.port) ||
      probe.port < 1 ||
      probe.port > 65535 ||
      !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(probe.token ?? ''))
  )
    throw new Error('Invalid production cancellation probe');
  const testingEnvironment = { ...input.testingEnvironment };
  if (probe) {
    testingEnvironment.OROT_PRODUCTION_CANCEL_PORT = String(probe.port);
    testingEnvironment.OROT_PRODUCTION_CANCEL_TOKEN = probe.token;
  }
  return {
    __xctestrun_metadata__: { FormatVersion: 1 },
    OrotUITests: {
      BlueprintName: 'OrotUITests',
      IsUITestBundle: true,
      IsXCTRunnerHostedTestBundle: true,
      TestHostPath: input.runnerPath,
      TestBundlePath: input.bundlePath,
      UITargetAppPath: input.productionAppPath,
      DependentProductPaths: [
        input.productionAppPath,
        input.runnerPath,
        join(input.runnerPath, 'PlugIns/OrotUITests.xctest'),
      ],
      TestHostBundleIdentifier: input.runnerId,
      TestingEnvironmentVariables: testingEnvironment,
      OnlyTestIdentifiers: [
        (probe ? productionCancellationTest : productionConversationTest).slice(
          'OrotUITests/'.length,
        ),
      ],
    },
  };
}

/** Reject ambiguous identities before any destination mutation. Provenance must be established by the caller. */
export function validateProductionInputs(input) {
  if (
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(input.udid ?? '') ||
    !isAbsolute(input.productionAppPath ?? '') ||
    !isAbsolute(input.runnerPath ?? '') ||
    input.appId !== 'com.orot.mobile' ||
    !/^com\.orot\.mobile\.[A-Za-z0-9.-]+$/.test(input.bundleId ?? '') ||
    input.runnerId !== input.bundleId + '.xctrunner' ||
    input.bundlePath !== '__TESTHOST__/PlugIns/OrotUITests.xctest' ||
    !/^[a-f0-9]{64}$/.test(input.binaryHash ?? '') ||
    input.binaryHash !== input.installedHash ||
    !/^[a-f0-9]{64}$/.test(input.jsBundleHash ?? '') ||
    input.jsBundleHash !== input.installedJsBundleHash ||
    input.configuration !== 'Release' ||
    input.entry !== 'index.js' ||
    input.orotTests !== false
  )
    throw new Error('Invalid production destination or product identity');
}
