import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { startIosAuthDiagnostics } from '../ios-auth-diagnostics.mjs';

const payload = {
  event: 'start-return',
  attempt: '00000000-0000-4000-8000-000000000001',
  sequence: 3,
  uptimeSeconds: 42.5,
  applicationState: 0,
  sceneStates: [0],
  sessionRetained: true,
  continuationRetained: true,
  presentationWindowRetained: true,
  presentationWindowIsKey: true,
  started: true,
};
const valid = 'OROT_AUTH_DIAGNOSTIC ' + JSON.stringify(payload) + '\n';
const preamble =
  'Filtering the log data using "process == "Orot" AND composedMessage BEGINSWITH "OROT_AUTH_DIAGNOSTIC ""\n';

// Real disposable Node child pipes exercise stream boundaries and cleanup; this is not hosted or native-auth proof.
function fixture(program, options = {}, streamError = false) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-auth-log-'));
  const path = join(directory, 'auth.jsonl');
  let invocation;
  let ready;
  let ended;
  const started = new Promise((resolve) => (ready = resolve));
  const closed = new Promise((resolve) => (ended = resolve));
  const stop = startIosAuthDiagnostics('owned-udid', path, {
    ...options,
    spawnProcess: (command, args, settings) => {
      invocation = { command, args };
      const child = spawn(process.execPath, ['-e', program], settings);
      child.once('close', ended);
      let observed = '';
      child.stdout.on('data', (chunk) => {
        observed += chunk.toString();
        if (observed.includes('READY\n')) ready();
        if (streamError) child.stdout.destroy(new Error('SECRET_READ_ERROR'));
      });
      return child;
    },
  });
  return { directory, path, stop, started, closed, invocation };
}

test(
  'retains split valid records and drops raw tool errors and sensitive payloads',
  { timeout: 10000 },
  async () => {
    const rejected = [
      { token: 'SECRET_TOKEN' },
      { attempt: [payload.attempt] },
      { attempt: { toString: null } },
    ]
      .map((change) => 'OROT_AUTH_DIAGNOSTIC ' + JSON.stringify({ ...payload, ...change }) + '\n')
      .join('');
    const value = fixture(`process.stdout.write(${JSON.stringify(preamble + valid.slice(0, 30))});
setTimeout(() => { process.stdout.write(${JSON.stringify(valid.slice(30) + rejected + 'READY\n')}); process.stderr.write('SECRET_ERROR'); }, 20);
setInterval(() => {}, 1000);`);
    try {
      await value.started;
      const record = await value.stop();
      assert.equal(record.closed, true);
      assert.equal(record.accepted, 1);
      assert.equal(record.rejected, 3);
      assert.equal(record.complete, false);
      assert.deepEqual(readFileSync(value.path, 'utf8').trim().split('\n').map(JSON.parse), [
        payload,
      ]);
      assert.doesNotMatch(readFileSync(value.path + '.json', 'utf8'), /SECRET/);
      assert.equal(value.invocation.command, 'xcrun');
      assert.deepEqual(value.invocation.args.slice(0, 5), [
        'simctl',
        'spawn',
        'owned-udid',
        'log',
        'stream',
      ]);
      assert.ok(value.invocation.args.includes('15m'));
      assert.deepEqual(await value.stop(), record);
    } finally {
      await value.stop();
      rmSync(value.directory, { recursive: true, force: true });
    }
  },
);

test(
  'marks a complete valid capture and terminates only its child, including an ignored graceful stop',
  { timeout: 10000 },
  async () => {
    for (const ignoreStop of [false, true]) {
      const value = fixture(
        `${ignoreStop ? "process.on('SIGTERM', () => {});" : ''}
process.stdout.write(${JSON.stringify(preamble + valid + 'READY\n')}); setInterval(() => {}, 1000);`,
        { stopGraceMs: 25 },
      );
      try {
        await value.started;
        const record = await value.stop();
        assert.equal(record.complete, true);
        assert.equal(record.closed, true);
        assert.equal(record.signal, ignoreStop ? 'SIGKILL' : 'SIGTERM');
        assert.equal(record.unexpectedExit, false);
        assert.equal(record.exitedBeforeStop, false);
      } finally {
        await value.stop();
        rmSync(value.directory, { recursive: true, force: true });
      }
    }
  },
);

test(
  'caps input and never stores oversized or unrelated raw content',
  { timeout: 10000 },
  async () => {
    const value = fixture(
      "process.on('SIGTERM', () => {}); process.stdout.write('READY\\n' + 'SECRET'.repeat(10000)); setInterval(() => {}, 1000);",
      { maxInputBytes: 128, stopGraceMs: 25 },
    );
    try {
      await value.started;
      await value.closed;
      const record = await value.stop();
      assert.equal(record.truncated, true);
      assert.equal(record.complete, false);
      assert.equal(record.signal, 'SIGKILL');
      assert.equal(readFileSync(value.path, 'utf8'), '');
    } finally {
      await value.stop();
      rmSync(value.directory, { recursive: true, force: true });
    }
  },
);

test('preserves existing files and records spawn failures without copying error contents', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-auth-failed-'));
  const path = join(directory, 'auth.jsonl');
  try {
    const stop = startIosAuthDiagnostics('owned-udid', path, {
      spawnProcess: () => {
        throw new Error('SECRET_ERROR');
      },
    });
    const record = await stop();
    assert.equal(record.error, 'collector-start-unavailable');
    assert.equal(record.complete, false);
    assert.doesNotMatch(readFileSync(path + '.json', 'utf8'), /SECRET_ERROR/);
    writeFileSync(path, 'original evidence');
    const collision = startIosAuthDiagnostics('owned-udid', path, {
      spawnProcess: () => assert.fail('Do not spawn after a collision'),
    });
    assert.equal((await collision()).error, 'output-open-unavailable');
    assert.equal(readFileSync(path, 'utf8'), 'original evidence');
    assert.throws(() => startIosAuthDiagnostics('booted', path), /owned destination/);
    for (const options of [{ maxInputBytes: 0 }, { maxInputBytes: 1048577 }, { stopGraceMs: 2001 }])
      assert.throws(() => startIosAuthDiagnostics('owned-udid', path, options), /limits/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test(
  'stream errors and premature exits remain unavailable without exposing the error text',
  { timeout: 10000 },
  async () => {
    for (const streamError of [false, true]) {
      const value = fixture(
        `process.stdout.write(${JSON.stringify(valid + 'READY\n')}); ${streamError ? 'setInterval(() => {}, 1000);' : ''}`,
        {},
        streamError,
      );
      try {
        await value.started;
        await value.closed;
        const record = await value.stop();
        assert.equal(record.complete, false);
        assert.equal(record.exitedBeforeStop, true);
        if (streamError) assert.equal(record.error, 'collector-stream-unavailable');
        assert.doesNotMatch(readFileSync(value.path + '.json', 'utf8'), /SECRET_READ_ERROR/);
      } finally {
        await value.stop();
        rmSync(value.directory, { recursive: true, force: true });
      }
    }
  },
);
