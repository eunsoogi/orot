import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';

const appRequire = createRequire(resolve('apps/mobile/package.json'));
const nativeRequire = createRequire(appRequire.resolve('react-native/package.json'));
const metroRequire = createRequire(nativeRequire.resolve('metro-runtime/package.json'));
const metroPackageRequire = createRequire(nativeRequire.resolve('metro/package.json'));
const metroPackageRoot = dirname(metroPackageRequire.resolve('metro/package.json'));
const MetroWorkerFarm = metroPackageRequire(
  join(metroPackageRoot, 'src/DeltaBundler/WorkerFarm.js'),
).default;
const agentRuntimeRequire = createRequire(resolve('packages/agent-runtime/package.json'));
const langchainCoreRequire = createRequire(
  agentRuntimeRequire.resolve('@langchain/core/package.json'),
);
const pQueueRequire = createRequire(langchainCoreRequire.resolve('p-queue/package.json'));
const { transformSync } = appRequire('@babel/core');
const bundle = 'var orotBundleValue = 41; global.orotModule = () => orotBundleValue + 1;';

// Xcode must rerun Metro's bundle phase while its generated bundle and asset outputs are not enumerated.
test('React Native bundle phase is marked to run every build when it has no declared outputs', () => {
  const project = readFileSync(
    resolve('apps/mobile/ios/OrotMobile.xcodeproj/project.pbxproj'),
    'utf8',
  );
  const phase = project.match(
    /00DD1BFF1BD5951E006B06BC \/\* Bundle React Native code and images \*\/ = \{([\s\S]*?)\n\t\t\};/,
  );

  assert.ok(phase, 'expected the app bundle build phase');
  assert.match(phase[1], /outputPaths = \(\s*\);/);
  assert.match(phase[1], /alwaysOutOfDate = 1;/);
});

function context(nativeEvaluation, mocks = {}) {
  const sandbox = createContext({
    module: { exports: {} },
    require: (name) => mocks[name] ?? nativeRequire(name),
    WebSocket: class {},
    setInterval,
    clearInterval,
  });
  sandbox.global = sandbox;
  sandbox.exports = sandbox.module.exports;
  if (nativeEvaluation) sandbox.globalEvalWithSourceUrl = (code) => runInContext(code, sandbox);
  return sandbox;
}

// LangChain bundles this pinned queue into the Release app; Hermes needs timer globals accessed through the global object.
test('LangSmith queue uses explicit global timers for Hermes bundle compilation', () => {
  const packageJson = JSON.parse(
    readFileSync(pQueueRequire.resolve('p-queue/package.json'), 'utf8'),
  );
  const source = readFileSync(pQueueRequire.resolve('p-queue'), 'utf8');
  assert.equal(packageJson.version, '6.6.2');
  assert.equal(source.match(/\bglobalThis\.setInterval\s*\(/g)?.length, 1);
  assert.equal(source.match(/\bglobalThis\.clearInterval\s*\(/g)?.length, 2);
  assert.doesNotMatch(source, /(?<![\w$.])(?:setInterval|clearInterval)\s*\(/);
});

// Both actual development loaders must evaluate module registration in the same
// global scope as RN's native evaluator; Hermes cannot provide lexical eval.
test('HMR fallback matches native global evaluation and keeps module closures working', () => {
  const source = readFileSync(metroRequire.resolve('./src/modules/HMRClient.js'), 'utf8');
  for (const nativeEvaluation of [true, false]) {
    const sandbox = context(nativeEvaluation, { './vendor/eventemitter3': EventEmitter });
    runInContext(source, sandbox);
    const client = new sandbox.module.exports('ws://test.invalid');
    client.enable();
    client.emit('update', {
      added: [{ module: [1, bundle], sourceURL: 'fixture.js' }],
      modified: [],
    });
    assert.equal(sandbox.orotModule(), 42);
    assert.equal(sandbox.orotBundleValue, 41, `native evaluator: ${nativeEvaluation}`);
    assert.throws(
      () =>
        client.emit('update', {
          added: [{ module: [2, 'throw new Error("bundle failure")'], sourceURL: 'failure.js' }],
          modified: [],
        }),
      /bundle failure/,
    );
  }
});

test('network bundle fallback matches native scope and removes all response listeners', async () => {
  const path = nativeRequire.resolve('./Libraries/Core/Devtools/loadBundleFromServer.js');
  const { code } = transformSync(readFileSync(path, 'utf8'), {
    filename: path,
    configFile: false,
    babelrc: false,
    presets: [appRequire.resolve('@react-native/babel-preset')],
  });
  for (const nativeEvaluation of [true, false]) {
    const listeners = new Map();
    const registrations = [];
    const networking = {
      addListener(name, callback) {
        listeners.set(name, callback);
        return { remove: () => listeners.delete(name) };
      },
      sendRequest(...args) {
        args[8](7);
        queueMicrotask(() => {
          listeners.get('didReceiveNetworkResponse')([
            7,
            200,
            { 'Content-Type': 'application/javascript' },
          ]);
          listeners.get('didReceiveNetworkData')([7, bundle]);
          listeners.get('didCompleteNetworkResponse')([7, null, false]);
        });
      },
    };
    const sandbox = context(nativeEvaluation, {
      '../../Network/RCTNetworking': networking,
      '../../Utilities/DevLoadingView': { showMessage() {}, hide() {} },
      '../../Utilities/HMRClient': { registerBundle: (url) => registrations.push(url) },
      './getDevServer': () => ({ url: 'http://test.invalid:8081/' }),
    });
    runInContext(code, sandbox);
    await sandbox.module.exports.default('fixture.bundle');
    assert.equal(sandbox.orotModule(), 42);
    assert.equal(sandbox.orotBundleValue, 41, `native evaluator: ${nativeEvaluation}`);
    assert.deepEqual(registrations, ['http://test.invalid:8081/fixture.bundle']);
    assert.equal(listeners.size, 0);
  }
});

test('real Metro worker process preserves NO_COLOR without injecting conflicting FORCE_COLOR', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-worker-color-'));
  const worker = join(directory, 'worker.cjs');
  const runner = join(directory, 'runner.cjs');
  writeFileSync(
    worker,
    'exports.colors = () => ({ no: process.env.NO_COLOR, force: process.env.FORCE_COLOR });',
  );
  writeFileSync(
    runner,
    `
    const { Worker } = require(process.argv.at(-1));
    const worker = new Worker(process.argv.at(-2), { numWorkers: 1, maxRetries: 0 });
    worker.getStderr().pipe(process.stderr);
    (async () => {
      try { process.stdout.write(JSON.stringify(await worker.colors())); }
      finally { await worker.end(); }
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `,
  );
  const environment = { ...process.env, NO_COLOR: '1' };
  delete environment.FORCE_COLOR;
  try {
    const result = spawnSync(
      process.execPath,
      [runner, '--color', worker, metroRequire.resolve('jest-worker')],
      {
        encoding: 'utf8',
        env: environment,
        timeout: 15000,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { no: '1' });
    assert.doesNotMatch(result.stderr, /NO_COLOR.*ignored/);
    delete environment.NO_COLOR;
    const colored = spawnSync(
      process.execPath,
      [runner, '--color', worker, metroRequire.resolve('jest-worker')],
      { encoding: 'utf8', env: environment, timeout: 15000 },
    );
    assert.equal(colored.status, 0, colored.stderr);
    assert.deepEqual(JSON.parse(colored.stdout), { force: '1' });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// Metro supplies a caller-owned fork environment, so exercise that layer with a real child worker.
test('Metro transform workers preserve caller color settings and only add their default when allowed', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-metro-worker-color-'));
  const workerPath = join(directory, 'worker.cjs');
  writeFileSync(
    workerPath,
    'exports.colors = () => ({ no: process.env.NO_COLOR, force: process.env.FORCE_COLOR });',
  );
  const previousEnvironment = {
    NO_COLOR: process.env.NO_COLOR,
    FORCE_COLOR: process.env.FORCE_COLOR,
  };
  const farm = Object.create(MetroWorkerFarm.prototype);
  farm._config = { stickyWorkers: false, transformer: { unstable_workerThreads: false } };

  async function readWorkerEnvironment() {
    const worker = farm._makeFarm(workerPath, ['colors'], 1);
    try {
      return await worker.colors();
    } finally {
      await worker.end();
    }
  }

  try {
    process.env.NO_COLOR = '1';
    delete process.env.FORCE_COLOR;
    const noColor = await readWorkerEnvironment();
    assert.equal(noColor.no, '1');
    assert.equal(noColor.force, undefined);

    // Caller-owned FORCE_COLOR keeps Node's documented precedence if both values were set.
    process.env.FORCE_COLOR = '2';
    const explicitForce = await readWorkerEnvironment();
    assert.deepEqual(explicitForce, { no: '1', force: '2' });

    delete process.env.FORCE_COLOR;
    delete process.env.NO_COLOR;
    const defaultColor = await readWorkerEnvironment();
    assert.equal(defaultColor.force, '1');
  } finally {
    if (previousEnvironment.NO_COLOR === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = previousEnvironment.NO_COLOR;
    if (previousEnvironment.FORCE_COLOR === undefined) delete process.env.FORCE_COLOR;
    else process.env.FORCE_COLOR = previousEnvironment.FORCE_COLOR;
    rmSync(directory, { recursive: true, force: true });
  }
});
