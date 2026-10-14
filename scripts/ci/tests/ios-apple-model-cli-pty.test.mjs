import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { appleModelCliAcceptanceArguments } from '../apple-model-cli-deadline.mjs';

const standin = `
import { openSync, closeSync } from 'node:fs';
let controllingTerminal = false;
try { const fd = openSync('/dev/tty', 'r+'); closeSync(fd); controllingTerminal = true; } catch {}
const mode = process.argv[2];
console.log('STANDIN ' + JSON.stringify({ pid: process.pid, stdinTTY: Boolean(process.stdin.isTTY), stdoutTTY: Boolean(process.stdout.isTTY), stderrTTY: Boolean(process.stderr.isTTY), controllingTerminal }));
if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stderr.isTTY || !controllingTerminal) process.exit(69);
if (mode === 'hang') {
  process.on('SIGTERM', () => {}); process.on('SIGHUP', () => {});
  setInterval(() => {}, 1000);
} else if (mode === 'exit69') process.exit(69);
else {
  process.stdout.write('Do you agree? [yes/no] ');
  process.stdin.setEncoding('utf8');
  process.stdin.once('data', (answer) => {
    console.log('ANSWER ' + JSON.stringify({ answer: answer.trim() }));
    process.exit(mode === 'decline' ? 69 : (answer.trim() === 'yes' ? 0 : 69));
  });
}
`;

for (const [mode, expected] of [
  ['success', 0],
  ['decline', 69],
  ['exit69', 69],
  ['hang', 124],
]) {
  test(`the fixed PTY invocation preserves terminal interaction, ${mode} and owned cleanup`, (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'orot-fm-pty-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const child = join(directory, 'standin.mjs');
    writeFileSync(child, standin);
    const args = appleModelCliAcceptanceArguments().slice(1);
    // Replace only the fixed fm child and omit sudo; this never agrees to real terms.
    if (args[0] === process.execPath) {
      args[3] = args[3].replace(
        "'/usr/bin/fm', ['license']",
        `${JSON.stringify(process.execPath)}, [${JSON.stringify(child)}, ${JSON.stringify(mode)}]`,
      );
    } else {
      assert.equal(args[0], '/usr/bin/python3');
      const original = args[4];
      args[4] = original.replace(
        "os.execv('/usr/bin/fm', ['/usr/bin/fm', 'license'])",
        `os.execv(${JSON.stringify(process.execPath)}, [${JSON.stringify(process.execPath)}, ${JSON.stringify(child)}, ${JSON.stringify(mode)}])`,
      );
      assert.notEqual(args[4], original);
    }
    const started = Date.now();
    const result = spawnSync(args[0], args.slice(1), {
      encoding: 'utf8',
      shell: false,
      timeout: 5000,
      killSignal: 'SIGKILL',
      maxBuffer: 1024 * 1024,
    });
    const elapsedMs = Date.now() - started;
    const watchdog = JSON.parse(result.stdout);
    const observation = JSON.parse(watchdog.stdout.match(/STANDIN (\{[^\r\n]+\})/)[1]);
    t.diagnostic(
      JSON.stringify({
        mode,
        elapsedMs,
        exitCode: result.status,
        ...observation,
        actualPrivilegedCommandsExecuted: 0,
      }),
    );
    assert.ok(
      observation.stdinTTY &&
        observation.stdoutTTY &&
        observation.stderrTTY &&
        observation.controllingTerminal,
      'the representative CLI requires a real controlling terminal',
    );
    assert.equal(result.status, expected, result.stdout + result.stderr);
    assert.equal(result.error, undefined);
    assert.ok(elapsedMs < 5000);
    for (const pid of [result.pid, observation.pid])
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    if (mode === 'hang') assert.equal(watchdog.signal, 'SIGKILL');
    if (mode === 'success' || mode === 'decline')
      assert.match(watchdog.stdout, /ANSWER \{"answer":"yes"\}/);
  });
}
