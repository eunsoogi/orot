import { isDeepStrictEqual } from 'node:util';

/** Xcode's scheme-based build-for-testing output is format 1, with targets at the root. */
export function verifyTestRunContract(data, spec) {
  const metadata = data.__xctestrun_metadata__;
  if (
    metadata?.FormatVersion !== 1 ||
    metadata.ContainerInfo?.SchemeName !== spec.scheme ||
    metadata.ContainerInfo?.ContainerName !== 'OrotMobile'
  )
    throw new Error('Unsupported iOS test-run format or scheme identity');
  const names = Object.keys(data)
    .filter((name) => name !== '__xctestrun_metadata__')
    .sort();
  if (!isDeepStrictEqual(names, [spec.integrationTarget, spec.uiTarget].sort()))
    throw new Error(
      'iOS test-run file does not contain exactly the required integration and UI targets',
    );
  const configuration = spec.configuration + '-iphonesimulator';
  const app = `__TESTROOT__/${configuration}/${spec.appName}`;
  const runner = `__TESTROOT__/${configuration}/${spec.uiTarget}-Runner.app`;
  const integration = data[spec.integrationTarget];
  const ui = data[spec.uiTarget];
  if (
    integration.BlueprintName !== spec.integrationTarget ||
    integration.IsAppHostedTestBundle !== true ||
    integration.IsUITestBundle === true ||
    ui.BlueprintName !== spec.uiTarget ||
    ui.IsUITestBundle !== true ||
    ui.IsXCTRunnerHostedTestBundle !== true
  )
    throw new Error('Incorrect iOS hosted integration or UI test target');
  const expected = [
    [
      integration,
      {
        TestHostPath: app,
        TestBundlePath: `__TESTHOST__/PlugIns/${spec.integrationTarget}.xctest`,
      },
    ],
    [
      ui,
      {
        TestHostPath: runner,
        TestBundlePath: `__TESTHOST__/PlugIns/${spec.uiTarget}.xctest`,
        UITargetAppPath: app,
      },
    ],
  ];
  const dependencies = [
    app,
    `${app}/PlugIns/${spec.integrationTarget}.xctest`,
    runner,
    `${runner}/PlugIns/${spec.uiTarget}.xctest`,
  ].sort();
  for (const [target, paths] of expected) {
    for (const [field, path] of Object.entries(paths)) {
      if (target[field] !== path)
        throw new Error('iOS test-run product path is not portable or compatible');
    }
    if (!isDeepStrictEqual(target.DependentProductPaths?.slice().sort(), dependencies))
      throw new Error('Unexpected iOS test-run dependency paths');
    if (!isDeepStrictEqual(target.CommandLineArguments, ['-OROT_TEST_HOST', 'YES']))
      throw new Error('The integration test host isolation argument is missing');
  }
  return [integration, ui];
}
