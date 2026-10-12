import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('../detox-preparation-resources.mjs', import.meta.url));

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'orot-preparation-resources-'));
  const bin = join(directory, 'bin');
  mkdirSync(bin);
  for (const command of ['vm_stat', 'sysctl']) {
    writeFileSync(join(bin, command), '#!/usr/bin/env bash\nprintf "fixture memory\\n"\n', {
      mode: 0o755,
    });
  }
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    GITHUB_ACTIONS: 'true',
    GITHUB_RUN_ID: '198',
    GITHUB_RUN_ATTEMPT: '2',
    OROT_DETOX_RESOURCE_SAMPLING: 'true',
  };
  return {
    directory,
    env,
    identity: join(directory, 'preparation-resource-sampler.json'),
    log: join(directory, 'detox-preparation-resource-samples.log'),
    run(mode, profile = 'transcription', override = {}) {
      return spawnSync(process.execPath, [script, mode, profile, directory], {
        encoding: 'utf8',
        env: { ...env, ...override },
      });
    },
    cleanup() {
      this.run('stop');
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

async function waitForLog(context, pattern) {
  // Wait for an observed worker event rather than relying on host startup speed.
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (existsSync(context.log) && pattern.test(readFileSync(context.log, 'utf8'))) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('Sampler did not publish the required observation');
}

test('samples preparation independently and stops only its identified child', async () => {
  const context = fixture();
  try {
    const start = context.run('start');
    assert.equal(start.status, 0, start.stderr);
    await waitForLog(context, /fixture memory/);
    const identity = JSON.parse(readFileSync(context.identity, 'utf8'));
    assert.equal(identity.runId, '198');
    assert.equal(identity.attempt, '2');
    assert.notEqual(identity.pid, process.pid);
    const stop = context.run('stop');
    assert.equal(stop.status, 0, stop.stderr);
    await waitForLog(context, /DETOX_PREPARATION_RESOURCE_END/);
    assert.equal(existsSync(context.identity), false);
    assert.match(readFileSync(context.log, 'utf8'), /ps -A -o pid= -o ppid= -o rss= -o comm=/);
  } finally {
    context.cleanup();
  }
});

test('leaves monitoring off for other profiles and unrequested sampling', () => {
  const context = fixture();
  try {
    assert.equal(context.run('start', 'release').status, 0);
    assert.equal(
      context.run('start', 'transcription', { OROT_DETOX_RESOURCE_SAMPLING: 'false' }).status,
      0,
    );
    assert.equal(existsSync(context.identity), false);
    assert.equal(existsSync(context.log), false);
  } finally {
    context.cleanup();
  }
});

test('refuses to stop an identity from another run or a reused PID', () => {
  const context = fixture();
  try {
    const identity = {
      pid: process.pid,
      token: '11111111-2222-4333-8444-555555555555',
      runId: '197',
      attempt: '2',
    };
    writeFileSync(context.identity, JSON.stringify(identity));
    const otherRun = context.run('stop');
    assert.notEqual(otherRun.status, 0);
    assert.match(otherRun.stderr, /ownership mismatch/);
    writeFileSync(context.identity, JSON.stringify({ ...identity, runId: '198' }));
    const reusedPid = context.run('stop');
    assert.notEqual(reusedPid.status, 0);
    assert.match(reusedPid.stderr, /process mismatch/);
  } finally {
    rmSync(context.directory, { recursive: true, force: true });
  }
});
