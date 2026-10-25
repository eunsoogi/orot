import { startIosSimulatorLifecycleDiagnostics } from './ios-simulator-lifecycle-diagnostics.mjs';

/** Bind lifecycle collection to a selected UI test invocation, unless its fixture owner captures it. */
export async function startIosSimulatorLifecycleDiagnosticsForUiTests({
  udid,
  path,
  invocationId,
  profile,
  tests,
  uiTarget,
}) {
  if (
    !tests.some((test) => test.startsWith(uiTarget + '/')) ||
    process.env.TEST_RUNNER_OROT_IOS_SIMULATOR_LIFECYCLE_EXTERNAL_CAPTURE === '1'
  )
    return async () => {};
  const stop = await startIosSimulatorLifecycleDiagnostics(udid, path, {
    invocationId,
    profile,
    tests,
    sourceSha: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT,
  });
  return async (result) => {
    try {
      await stop(result);
    } catch (error) {
      console.error('IOS_SIMULATOR_LIFECYCLE_DIAGNOSTIC_UNAVAILABLE ' + String(error));
    }
  };
}
