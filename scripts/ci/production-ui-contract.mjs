import { isDeepStrictEqual } from 'node:util';

/** Fail before installing a runner that cannot expose the selected XCTest case. */
export function verifyProductionTestSymbols(symbols, strings) {
  if (
    !symbols.includes('OrotUITests32ProductionRagConversationUITests') ||
    !strings.includes('testProductionConversationAndReturnError:')
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

/** Construct only the destination-backed UI target; no fixture product path is retained. */
export function productionTestRun(input) {
  validateProductionInputs(input);
  return {
    __xctestrun_metadata__: { FormatVersion: 1 },
    OrotUITests: {
      BlueprintName: 'OrotUITests',
      IsUITestBundle: true,
      IsXCTRunnerHostedTestBundle: true,
      UseDestinationArtifacts: true,
      TestHostBundleIdentifier: input.runnerId,
      TestBundleDestinationRelativePath: input.bundlePath,
      UITargetAppBundleIdentifier: input.appId,
      TestingEnvironmentVariables: input.testingEnvironment,
      OnlyTestIdentifiers: ['ProductionRagConversationUITests/testProductionConversation'],
    },
  };
}

/** Reject ambiguous identities before any destination mutation. Provenance must be established by the caller. */
export function validateProductionInputs(input) {
  if (
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(input.udid ?? '') ||
    input.appId !== 'com.orot.mobile' ||
    !/^com\.orot\.mobile\.[A-Za-z0-9.-]+$/.test(input.bundleId ?? '') ||
    input.runnerId !== input.bundleId + '.xctrunner' ||
    input.bundlePath !== '__TESTHOST__/PlugIns/OrotUITests.xctest' ||
    !/^[a-f0-9]{64}$/.test(input.binaryHash ?? '') ||
    input.binaryHash !== input.installedHash ||
    input.configuration !== 'Release' ||
    input.entry !== 'index.js' ||
    input.orotTests !== false
  )
    throw new Error('Invalid production destination or product identity');
}
