import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { startIosSpeechDiagnostics } from '../ios-speech-diagnostics.mjs';
import { iosTestConfig } from '../ios-test-config.mjs';

// Disposable Node children exercise collector ownership and pipes without touching Simulator services.
function collector(program, options = {}, readyText) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-speech-log-'));
  const path = join(directory, 'speech.log');
  let invocation;
  let ready;
  const started = new Promise((resolveReady, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Collector fixture did not become ready')),
      10_000,
    );
    ready = () => {
      clearTimeout(timer);
      resolveReady();
    };
  });
  const stop = startIosSpeechDiagnostics('owned-udid', path, {
    ...options,
    spawnProcess: (command, args, settings) => {
      invocation = { command, args, settings };
      const child = spawn(process.execPath, ['-e', program], settings);
      let observed = '';
      // Pipes may arrive separately or split a marker. Stop only after the required output is observed.
      for (const stream of [child.stdout, child.stderr]) {
        stream.on('data', (chunk) => {
          observed += chunk.toString();
          if (!readyText || observed.includes(readyText)) ready();
        });
      }
      return child;
    },
  });
  return { directory, path, stop, started, invocation };
}

test('streams only selected public logs from the exact owned destination and closes its child', async () => {
  const result = collector(
    "process.stdout.write('asset begin\\n'); setTimeout(() => process.stderr.write('speech begin\\n'), 200); setInterval(() => {}, 1000);",
    {},
    'speech begin',
  );
  try {
    await result.started;
    const record = await result.stop();
    assert.equal(record.closed, true);
    assert.equal(record.signal, 'SIGTERM');
    assert.equal(record.truncated, false);
    assert.match(readFileSync(result.path, 'utf8'), /asset begin/);
    assert.match(readFileSync(result.path, 'utf8'), /speech begin/);
    assert.deepEqual(result.invocation.args.slice(0, 5), [
      'simctl',
      'spawn',
      'owned-udid',
      'log',
      'stream',
    ]);
    assert.ok(result.invocation.args.includes('90m'));
    assert.match(result.invocation.args.at(-1), /mobileassetd/);
    assert.doesNotMatch(result.invocation.args.join(' '), /privacy|killall|booted/);
    assert.deepEqual(await result.stop(), record);
    assert.deepEqual(JSON.parse(readFileSync(result.path + '.json', 'utf8')), record);
  } finally {
    await result.stop();
    rmSync(result.directory, { recursive: true, force: true });
  }
});

test('caps retained bytes while preserving the latest failure instead of stopping at a noisy prelude', async () => {
  const result = collector(
    "process.stdout.write('x'.repeat(4096) + 'LATE_'); setTimeout(() => process.stdout.write('FAILURE'), 20); setInterval(() => {}, 1000);",
    {
      maxBytes: 128,
    },
    'LATE_FAILURE',
  );
  try {
    await result.started;
    const record = await result.stop();
    assert.equal(readFileSync(result.path).length, 128);
    assert.equal(record.capturedBytes, 128);
    assert.equal(record.truncated, true);
    assert.match(readFileSync(result.path, 'utf8'), /LATE_FAILURE$/);
    assert.equal(record.closed, true);
  } finally {
    await result.stop();
    rmSync(result.directory, { recursive: true, force: true });
  }
});

test('orders a wrapped tail and accepts simctl-style termination after its own signal', async () => {
  const result = collector(
    "process.on('SIGTERM', () => process.exit(143)); process.stdout.write('0123456789'); setTimeout(() => process.stdout.write('ABCDEFGHIJ'), 20); setInterval(() => {}, 1000);",
    { maxBytes: 16 },
    'ABCDEFGHIJ',
  );
  try {
    await result.started;
    const record = await result.stop();
    assert.equal(readFileSync(result.path, 'utf8'), '456789ABCDEFGHIJ');
    assert.equal(record.observedBytes, 20);
    assert.equal(record.exitCode, 143);
    assert.equal(record.unexpectedExit, false);
  } finally {
    await result.stop();
    rmSync(result.directory, { recursive: true, force: true });
  }
});

test('a collector ignoring graceful termination is killed through its own child handle', async () => {
  const result = collector(
    "process.on('SIGTERM', () => {}); process.stdout.write('ready'); setInterval(() => {}, 1000);",
    { stopGraceMs: 25 },
  );
  try {
    await result.started;
    const record = await result.stop();
    assert.equal(record.closed, true);
    assert.equal(record.signal, 'SIGKILL');
  } finally {
    await result.stop();
    rmSync(result.directory, { recursive: true, force: true });
  }
});

test('records unavailable spawn and preserves existing evidence instead of overwriting it', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-speech-unavailable-'));
  const path = join(directory, 'speech.log');
  try {
    const stop = startIosSpeechDiagnostics('owned-udid', path, {
      spawnProcess: () => {
        throw new Error('collector unavailable');
      },
    });
    assert.match((await stop()).error, /collector unavailable/);
    writeFileSync(path, 'original evidence');
    const unavailable = startIosSpeechDiagnostics('owned-udid', path, {
      spawnProcess: () => {
        assert.fail('must not spawn after an output collision');
      },
    });
    assert.match((await unavailable()).error, /EEXIST/);
    assert.equal(readFileSync(path, 'utf8'), 'original evidence');
    assert.throws(() => startIosSpeechDiagnostics('booted', path), /owned destination/);
    for (const options of [{ maxBytes: 0 }, { maxBytes: 9 * 1024 * 1024 }, { stopGraceMs: 2001 }])
      assert.throws(
        () => startIosSpeechDiagnostics('owned-udid', path, options),
        /diagnostic limits/,
      );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const status of [0, 65]) {
  test(`an unavailable Speech log stream preserves the first native test exit ${status}`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'orot-speech-runner-'));
    const config = iosTestConfig('speech');
    const owner = { ...config, name: 'owned-fixture', udid: 'owned-udid' };
    const calls = join(directory, 'calls.jsonl');
    const collectorPid = join(directory, 'collector.pid');
    const program = `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const name = require('node:path').basename(process.argv[1]);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({name,args})+'\\n');
// The native fixture completes only after the collector really exits, regardless of startup order.
if (name === 'xcodebuild') {
  const started = Date.now();
  const awaitCollectorExit = () => {
    try {
      const pid = Number(fs.readFileSync(${JSON.stringify(collectorPid)}, 'utf8'));
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') process.exit(${status});
      if (error.code !== 'ENOENT') throw error;
    }
    if (Date.now() - started > 10000) throw new Error('Collector fixture did not exit');
    setTimeout(awaitCollectorExit, 10);
  };
  awaitCollectorExit();
} else if (args.includes('stream')) {
  fs.writeFileSync(${JSON.stringify(collectorPid)}, String(process.pid));
  setTimeout(() => process.exit(23), 100);
} else if (args[1] === 'list' && args[2] === '-j') console.log(JSON.stringify({runtimes:[{identifier:${JSON.stringify(config.runtime)},buildversion:${JSON.stringify(config.runtimeBuild)},isAvailable:true}],devices:{[${JSON.stringify(config.runtime)}]:[{udid:'owned-udid',name:'owned-fixture',deviceTypeIdentifier:${JSON.stringify(config.device)},state:'Booted'}]}}));
else console.log('fixture diagnostic');
`;
    try {
      for (const name of ['xcrun', 'xcodebuild', 'vm_stat', 'sysctl', 'ps'])
        writeFileSync(join(directory, name), program, { mode: 0o755 });
      const ownerFile = join(directory, 'owner.json');
      const products = join(directory, 'products.xctestrun');
      const result = join(directory, 'result.xcresult');
      writeFileSync(ownerFile, JSON.stringify(owner));
      writeFileSync(products, 'fixture products');
      const outcome = spawnSync(
        process.execPath,
        [resolve('scripts/ci/run-ios-tests.mjs'), 'speech', products, ownerFile, result],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            OROT_IOS_TEST_SUITE: 'preparation',
            PATH: directory + ':' + process.env.PATH,
          },
        },
      );
      assert.equal(outcome.status, status, outcome.stderr);
      const actual = readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse);
      assert.equal(actual.filter((call) => call.name === 'xcodebuild').length, 1);
      assert.equal(actual.filter((call) => call.args.includes('stream')).length, 1);
      const metadata = JSON.parse(readFileSync(result + '.speech-system.log.json', 'utf8'));
      assert.equal(metadata.closed, true);
      assert.equal(metadata.exitCode, 23);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
