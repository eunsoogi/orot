import { resolve } from 'node:path';

/** Shared argument construction keeps the runner's existing single-destination, no-retry and diagnostic boundaries. */
export function iosTestXcodeArguments({ runFile, results, udid, tests }) {
  return [
    'test-without-building',
    '-xctestrun',
    resolve(runFile),
    '-destination',
    'platform=iOS Simulator,id=' + udid,
    '-resultBundlePath',
    resolve(results),
    '-parallel-testing-enabled',
    'NO',
    '-maximum-concurrent-test-simulator-destinations',
    '1',
    '-disableAutomaticPackageResolution',
    // Case duration is not an assertion; the owning job retains cancellation authority.
    '-test-timeouts-enabled',
    'NO',
    // Preserve the first xcresult/screenshots without Xcode's stalled 600-second simctl collection.
    '-collect-test-diagnostics',
    'never',
    ...tests.map((test) => '-only-testing:' + test),
  ];
}
