import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  productionCancellationTest,
  productionConversationTest,
  productionTestRun,
} from './production-ui-contract.mjs';
import { runOwned } from './production-ui-cancellation.mjs';
import { runProductionCancellationProbe } from './production-ui-native-cancellation.mjs';
import { readProductionTrace } from './production-ui-diagnostics.mjs';

/** Keep probe selection separate from the ordinary production conversation invocation. */
export async function runProductionTest({
  context,
  udid,
  resultPath,
  directory,
  installedRunner,
  installedApp,
  resolveInstalled,
  cancellationProbe,
}) {
  const testRun = join(directory, 'production.xctestrun');
  const selected = cancellationProbe ? productionCancellationTest : productionConversationTest;
  const prepare = (probe) => {
    context.verifySource();
    const expected = productionTestRun(context.input, probe);
    writeFileSync(testRun, JSON.stringify(expected));
    execFileSync('plutil', ['-convert', 'xml1', testRun], { timeout: 30000 });
    const configured = JSON.parse(
      execFileSync('plutil', ['-convert', 'json', '-o', '-', testRun], {
        encoding: 'utf8',
        timeout: 30000,
      }),
    );
    const identifiers = configured.OrotUITests?.OnlyTestIdentifiers;
    if (
      !Array.isArray(identifiers) ||
      identifiers.length !== 1 ||
      identifiers[0] !== selected.slice('OrotUITests/'.length) ||
      !isDeepStrictEqual(configured, expected) ||
      configured.OrotUITests?.UITargetAppPath !== context.input.productionAppPath ||
      configured.OrotUITests?.TestHostPath !== context.input.runnerPath ||
      configured.OrotUITests?.TestBundlePath !== context.input.bundlePath ||
      JSON.stringify(configured.OrotUITests?.DependentProductPaths) !==
        JSON.stringify([
          context.input.productionAppPath,
          context.input.runnerPath,
          join(context.input.runnerPath, 'PlugIns/OrotUITests.xctest'),
        ]) ||
      'UseDestinationArtifacts' in configured.OrotUITests
    )
      throw new Error('Generated production test selection is not exact');
    return [
      'test-without-building',
      '-xctestrun',
      testRun,
      '-destination',
      'platform=iOS Simulator,id=' + udid,
      '-resultBundlePath',
      resolve(resultPath),
      '-parallel-testing-enabled',
      'NO',
      '-only-testing:' + selected,
    ];
  };
  console.log(
    JSON.stringify({
      stage: 'runner_ready',
      sourceSha: context.sourceSha,
      binarySha: context.product.binarySha,
      jsBundleSha: context.product.jsBundleSha,
      runnerId: context.runnerInfo.id,
      test: selected,
    }),
  );
  const started = new Date();
  try {
    if (cancellationProbe)
      return await runProductionCancellationProbe({
        udid,
        runnerPath: installedRunner,
        appPath: installedApp,
        resolveInstalled,
        prepare,
      });
    const result = await runOwned('xcodebuild', prepare());
    if (result.code !== 0 || result.signal || result.cancellation)
      throw new Error('Native test failed or was cancelled: ' + JSON.stringify(result));
    return result;
  } finally {
    console.log(JSON.stringify({ stage: 'native_trace', ...readProductionTrace(udid, started) }));
  }
}
