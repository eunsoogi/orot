import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const gate = resolve('scripts/ci/fail-on-warning.mjs');

function withTimeout(promise, message, timeoutMs = 5000) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timeout));
}

function waitForProcessExit(pid) {
  return new Promise((resolveExit, reject) => {
    let poll;
    const timeout = setTimeout(() => {
      clearTimeout(poll);
      reject(new Error('pnpm command leader did not exit before cancellation'));
    }, 5000);

    function check() {
      try {
        process.kill(pid, 0);
      } catch (error) {
        if (error.code === 'ESRCH') {
          clearTimeout(timeout);
          resolveExit();
          return;
        }
        reject(error);
        return;
      }
      poll = setTimeout(check, 10);
    }

    check();
  });
}

test('forwards termination to descendants after the pnpm leader exits', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-ios-warning-signal-'));
  const marker = join(directory, 'child-closed');
  const nestedSource = [
    'const fs = require("node:fs");',
    'process.on("SIGTERM", () => setTimeout(() => { fs.writeFileSync(process.env.OROT_CHILD_MARKER, "closed"); process.exit(0); }, 50));',
    'console.log(`nested-pid:${process.pid}`);',
    'console.log("nested-ready");',
    'setInterval(() => {}, 1000);',
  ].join('\n');
  const source = [
    'const { spawn } = require("node:child_process");',
    'process.stdout.write(`direct-pid:${process.pid}\\n`);',
    `spawn(process.execPath, ["--input-type=commonjs", "-e", ${JSON.stringify(nestedSource)}], { stdio: ["ignore", "inherit", "inherit"] });`,
    'setTimeout(() => process.exit(0), 200);',
  ].join('\n');
  const command =
    process.platform === 'win32'
      ? ['pnpm', '--filter', '@orot/mobile', 'exec', 'node', '--input-type=commonjs', '-e', source]
      : [
          'sh',
          '-c',
          'printf "pnpm-pid:%s\\n" "$$"; exec pnpm --filter @orot/mobile exec node --input-type=commonjs -e "$1"',
          'warning-gate-test',
          source,
        ];
  const child = spawn(process.execPath, [gate, '--', ...command], {
    cwd: resolve('.'),
    detached: true,
    env: { ...process.env, OROT_CHILD_MARKER: marker },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let directPid;
  let nestedPid;
  let pnpmPid;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((accept, reject) => {
    resolveReady = accept;
    rejectReady = reject;
  });
  const closed = once(child, 'close');
  closed.catch(() => {});
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString('utf8');
    const directMatch = stdout.match(/direct-pid:(\d+)/);
    const nestedMatch = stdout.match(/nested-pid:(\d+)/);
    const pnpmMatch = stdout.match(/pnpm-pid:(\d+)/);
    if (directMatch) directPid ??= Number(directMatch[1]);
    if (nestedMatch) nestedPid ??= Number(nestedMatch[1]);
    if (pnpmMatch) pnpmPid ??= Number(pnpmMatch[1]);
    if (stdout.includes('nested-ready')) resolveReady();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
  });
  child.once('error', rejectReady);

  try {
    await withTimeout(ready, 'warning-gate child did not start');
    if (pnpmPid) await waitForProcessExit(pnpmPid);
    assert.equal(child.kill('SIGTERM'), true);
    const [code, signal] = await withTimeout(
      closed,
      'warning-gate did not wait for its nested child',
    );

    assert.equal(code, 143);
    assert.equal(signal, null);
    assert.equal(existsSync(marker), true);
    assert.match(
      stderr,
      /IOS_WARNING_GATE occurrences=0 accepted=0 blocking=0 child_status=143 signal=SIGTERM result=failed/,
    );
  } finally {
    if (!existsSync(marker)) {
      for (const pid of [nestedPid, directPid, pnpmPid]) {
        if (Number.isInteger(pid)) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            // A completed child is already reaped.
          }
        }
      }
    }
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await withTimeout(closed, 'warning-gate cleanup did not finish').catch(() => {});
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
