import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  productionTestingEnvironment,
  verifyProductionTestSymbols,
  validateProductionInputs,
} from './production-ui-contract.mjs';
import { cancellationPreflight, runOwned } from './production-ui-cancellation.mjs';
import { executeProductionUi } from './production-ui-execution.mjs';
import { runProductionTest } from './production-ui-runner.mjs';
import { verifyProductionProvenance } from './production-ui-provenance.mjs';
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
  swiftResponsePath,
  resultPath,
  ...extra
] = process.argv.slice(2);
if (!resultPath || extra.length > 1 || (extra.length && extra[0] !== '--cancellation-probe'))
  throw new Error(
    'Usage: run-ios-production-ui-tests.mjs <udid> <runner.app> <xctestrun> <production.app> <receipt.json> <settings.json> <build.log> <swift-response> <result.xcresult> [--cancellation-probe]',
  );
const cancellationProbe = extra.length === 1;
const command = (tool, args) =>
  execFileSync(tool, args, {
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
const plist = (path, key) =>
  command('plutil', ['-extract', key, 'raw', '-o', '-', join(path, 'Info.plist')]);
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const appId = 'com.orot.mobile';
const installedApp = () => command('xcrun', ['simctl', 'get_app_container', udid, appId, 'app']);
const dataContainer = () => command('xcrun', ['simctl', 'get_app_container', udid, appId, 'data']);
const metadata = (path) => ({
  id: plist(path, 'CFBundleIdentifier'),
  executable: plist(path, 'CFBundleExecutable'),
});
const appIdentity = (path) => {
  const info = metadata(path);
  if (info.id !== appId || info.executable !== 'Orot')
    throw new Error('Unexpected production app identity');
  const verified = verifyAppleModelProduct('production', path);
  if (verified.binaries.length !== 1) throw new Error('Expected one Release app binary');
  return { binarySha: verified.binaries[0].sha256, jsBundleSha: sha(join(path, 'main.jsbundle')) };
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
        cancellationProbe,
      );
      const app = realpathSync(appPath);
      const installed = installedApp();
      const product = appIdentity(app);
      const installedProduct = appIdentity(installed);
      const evidence = JSON.parse(readFileSync(receiptPath, 'utf8'));
      verifyProductionProvenance(
        evidence,
        readFileSync(settingsPath, 'utf8'),
        readFileSync(logPath, 'utf8'),
        installedProduct.binarySha,
        installedProduct.jsBundleSha,
        readFileSync(swiftResponsePath, 'utf8'),
      );
      const input = {
        udid,
        runnerId: runnerInfo.id,
        bundleId: bundleInfo.id,
        bundlePath: '__TESTHOST__/PlugIns/OrotUITests.xctest',
        appId,
        productionAppPath: app,
        runnerPath: runner,
        binaryHash: product.binarySha,
        installedHash: installedProduct.binarySha,
        jsBundleHash: product.jsBundleSha,
        installedJsBundleHash: installedProduct.jsBundleSha,
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
        product,
        sourceSha: evidence.sourceSha,
        dataContainer: dataContainer(),
        bundleHash: sha(join(bundle, bundleInfo.executable)),
        runnerHash: sha(join(runner, runnerInfo.executable)),
        verifySource() {
          const current = appIdentity(app);
          if (
            realpathSync(appPath) !== app ||
            realpathSync(runnerPath) !== runner ||
            current.binarySha !== product.binarySha ||
            current.jsBundleSha !== product.jsBundleSha ||
            sha(join(runner, runnerInfo.executable)) !== this.runnerHash ||
            sha(join(bundle, bundleInfo.executable)) !== this.bundleHash
          )
            throw new Error('Validated source products changed before test execution');
        },
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
      const installedProduct = appIdentity(installedApp());
      if (
        metadata(installedRunner).id !== context.runnerInfo.id ||
        metadata(installedBundle).id !== context.bundleInfo.id ||
        sha(join(installedRunner, context.runnerInfo.executable)) !== context.runnerHash ||
        sha(join(installedBundle, context.bundleInfo.executable)) !== context.bundleHash ||
        installedProduct.binarySha !== context.product.binarySha ||
        installedProduct.jsBundleSha !== context.product.jsBundleSha
      )
        throw new Error('Installed runner or production app differs from validated products');
      directory = mkdtempSync(join(tmpdir(), 'orot-production-ui-'));
      return runProductionTest({
        context,
        udid,
        resultPath,
        directory,
        installedRunner,
        installedApp: installedApp(),
        resolveInstalled: () => {
          const appPath = installedApp();
          const runnerPath = command('xcrun', [
            'simctl',
            'get_app_container',
            udid,
            context.runnerInfo.id,
            'app',
          ]);
          const current = appIdentity(appPath);
          const bundle = join(runnerPath, 'PlugIns', 'OrotUITests.xctest');
          if (
            current.binarySha !== context.product.binarySha ||
            current.jsBundleSha !== context.product.jsBundleSha ||
            metadata(runnerPath).id !== context.runnerInfo.id ||
            metadata(bundle).id !== context.bundleInfo.id ||
            sha(join(runnerPath, context.runnerInfo.executable)) !== context.runnerHash ||
            sha(join(bundle, context.bundleInfo.executable)) !== context.bundleHash
          )
            throw new Error('Reinstalled products differ from validated products');
          return { appPath, runnerPath };
        },
        cancellationProbe,
      });
    },
    verifyAfter(context) {
      const installed = appIdentity(installedApp());
      if (
        installed.binarySha !== context.product.binarySha ||
        installed.jsBundleSha !== context.product.jsBundleSha
      )
        throw new Error('Production app changed during the run');
      console.log(JSON.stringify({ stage: 'production_product_unchanged', ...installed }));
      // A container path match is an observation, not proof that user data survived.
      console.log(
        JSON.stringify({
          stage: 'production_data_container',
          samePath: dataContainer() === context.dataContainer,
          dataPreservation: 'unverified',
        }),
      );
    },
  });
  console.log(JSON.stringify({ stage: 'harness_finished', outcome }));
} finally {
  if (directory) rmSync(directory, { recursive: true, force: true });
}
