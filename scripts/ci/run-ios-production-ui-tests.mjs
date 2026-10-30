import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  productionTestRun,
  productionTestingEnvironment,
  verifyProductionTestSymbols,
  validateProductionInputs,
} from './production-ui-contract.mjs';
import { cancellationPreflight, runOwned } from './production-ui-cancellation.mjs';
import { executeProductionUi } from './production-ui-execution.mjs';
import { verifyProductionProvenance } from './production-ui-provenance.mjs';
import { readProductionTrace } from './production-ui-diagnostics.mjs';
import { verifyAppleModelProduct } from './verify-apple-model-product.mjs';
import { verifyTestRunContract } from './ios-test-run-contract.mjs';
import { iosTestBuildSpec } from './ios-test-config.mjs';

const [
  udid,
  runnerPath,
  runFile,
  appPath,
  receiptPath,
  settingsPath,
  logPath,
  resultPath,
  ...extra
] = process.argv.slice(2);
if (!resultPath || extra.length)
  throw new Error(
    'Usage: run-ios-production-ui-tests.mjs <udid> <runner.app> <xctestrun> <production.app> <receipt.json> <settings.json> <build.log> <result.xcresult>',
  );
const command = (tool, args) =>
  execFileSync(tool, args, { encoding: 'utf8', timeout: 30000 }).trim();
const plist = (path, key) =>
  command('plutil', ['-extract', key, 'raw', '-o', '-', join(path, 'Info.plist')]);
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const appId = 'com.orot.mobile';
const installedApp = () => command('xcrun', ['simctl', 'get_app_container', udid, appId, 'app']);
const metadata = (path) => ({
  id: plist(path, 'CFBundleIdentifier'),
  executable: plist(path, 'CFBundleExecutable'),
});
const appHash = (path) => {
  const info = metadata(path);
  if (info.id !== appId || info.executable !== 'Orot')
    throw new Error('Unexpected production app identity');
  const verified = verifyAppleModelProduct('production', path);
  if (verified.binaries.length !== 1) throw new Error('Expected one Release app binary');
  return verified.binaries[0].sha256;
};

let directory;
try {
  const outcome = await executeProductionUi({
    validate() {
      if (existsSync(resolve(resultPath))) throw new Error('Result bundle already exists');
      const devices = JSON.parse(command('xcrun', ['simctl', 'list', 'devices', '--json']));
      const matches = Object.values(devices.devices)
        .flat()
        .filter(
          (device) => device.udid === udid && device.state === 'Booted' && device.isAvailable,
        );
      if (matches.length !== 1)
        throw new Error('Destination must identify one booted, available Simulator');
      const runner = realpathSync(runnerPath);
      const bundle = join(runner, 'PlugIns', 'OrotUITests.xctest');
      const runnerInfo = metadata(runner);
      const bundleInfo = metadata(bundle);
      if (runnerInfo.executable !== 'OrotUITests-Runner' || bundleInfo.executable !== 'OrotUITests')
        throw new Error('Unexpected runner executable identity');
      const testBinary = join(bundle, bundleInfo.executable);
      verifyProductionTestSymbols(
        command('xcrun', ['nm', '-j', testBinary]),
        command('strings', [testBinary]),
      );
      const app = realpathSync(appPath);
      const installed = installedApp();
      const productHash = appHash(app);
      const installedHash = appHash(installed);
      const evidence = JSON.parse(readFileSync(receiptPath, 'utf8'));
      verifyProductionProvenance(
        evidence,
        readFileSync(settingsPath, 'utf8'),
        readFileSync(logPath, 'utf8'),
        installedHash,
      );
      const input = {
        udid,
        runnerId: runnerInfo.id,
        bundleId: bundleInfo.id,
        bundlePath: '__TESTHOST__/PlugIns/OrotUITests.xctest',
        appId,
        binaryHash: productHash,
        installedHash,
        configuration: 'Release',
        entry: evidence.entryFile ?? 'index.js',
        orotTests: false,
      };
      validateProductionInputs(input);
      const original = JSON.parse(
        command('plutil', ['-convert', 'json', '-o', '-', resolve(runFile)]),
      );
      verifyTestRunContract(original, iosTestBuildSpec('core'));
      input.testingEnvironment = productionTestingEnvironment(
        original.OrotUITests.TestingEnvironmentVariables,
        resolve(runFile, '..'),
      );
      const expectedRunner = resolve(
        runFile,
        '..',
        'Release-iphonesimulator',
        'OrotUITests-Runner.app',
      );
      if (realpathSync(expectedRunner) !== runner)
        throw new Error('Runner and test-run product do not match');
      command('git', ['cat-file', '-e', evidence.sourceSha + '^{commit}']);
      return {
        runner,
        runnerInfo,
        bundleInfo,
        input,
        productHash,
        sourceSha: evidence.sourceSha,
        bundleHash: sha(join(bundle, bundleInfo.executable)),
      };
    },
    preflight: cancellationPreflight,
    async installRunner(runner) {
      const result = await runOwned('xcrun', ['simctl', 'install', udid, runner]);
      if (result.code !== 0 || result.signal || result.cancellation)
        throw new Error('Runner install failed or was cancelled: ' + JSON.stringify(result));
    },
    async run(context) {
      const installedRunner = command('xcrun', [
        'simctl',
        'get_app_container',
        udid,
        context.runnerInfo.id,
        'app',
      ]);
      const installedBundle = join(installedRunner, 'PlugIns', 'OrotUITests.xctest');
      if (
        metadata(installedRunner).id !== context.runnerInfo.id ||
        metadata(installedBundle).id !== context.bundleInfo.id ||
        sha(join(installedBundle, context.bundleInfo.executable)) !== context.bundleHash ||
        appHash(installedApp()) !== context.productHash
      )
        throw new Error('Installed runner or production app differs from validated products');
      directory = mkdtempSync(join(tmpdir(), 'orot-production-ui-'));
      const testRun = join(directory, 'production.xctestrun');
      writeFileSync(testRun, JSON.stringify(productionTestRun(context.input)));
      command('plutil', ['-convert', 'xml1', testRun]);
      console.log(
        JSON.stringify({
          stage: 'runner_ready',
          sourceSha: context.sourceSha,
          binarySha: context.productHash,
          runnerId: context.runnerInfo.id,
          test: 'OrotUITests/ProductionRagConversationUITests/testProductionConversation',
        }),
      );
      const started = new Date();
      let result;
      try {
        result = await runOwned('xcodebuild', [
          'test-without-building',
          '-xctestrun',
          testRun,
          '-destination',
          'platform=iOS Simulator,id=' + udid,
          '-resultBundlePath',
          resolve(resultPath),
          '-parallel-testing-enabled',
          'NO',
          '-only-testing:OrotUITests/ProductionRagConversationUITests/testProductionConversation',
        ]);
      } finally {
        console.log(
          JSON.stringify({ stage: 'native_trace', ...readProductionTrace(udid, started) }),
        );
      }
      if (result.code !== 0 || result.signal || result.cancellation)
        throw new Error('Native test failed or was cancelled: ' + JSON.stringify(result));
      return result;
    },
    verifyAfter(context) {
      if (appHash(installedApp()) !== context.productHash)
        throw new Error('Production app changed during the run');
      console.log(
        JSON.stringify({ stage: 'production_binary_unchanged', binarySha: context.productHash }),
      );
    },
  });
  console.log(JSON.stringify({ stage: 'harness_finished', outcome }));
} finally {
  if (directory) rmSync(directory, { recursive: true, force: true });
}
