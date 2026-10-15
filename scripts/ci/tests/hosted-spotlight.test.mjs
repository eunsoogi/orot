import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { indexingDisabled, suppressHostedSpotlight } from '../suppress-hosted-spotlight.mjs';

const hosted = {
  CI: 'true',
  GITHUB_ACTIONS: 'true',
  RUNNER_OS: 'macOS',
  RUNNER_ENVIRONMENT: 'github-hosted',
};
const disabled = { status: 0, stdout: '/System/Volumes/Data:\n\tIndexing disabled.\n' };
function exercise(results, env = hosted, platform = 'darwin') {
  const calls = [];
  const events = [];
  const verified = suppressHostedSpotlight({
    env,
    platform,
    execute: (...args) => {
      calls.push(args);
      assert.ok(results.length, 'unexpected extra command or retry');
      return results.shift();
    },
    report: (event) => events.push(event),
  });
  return { calls, events, verified };
}

test('local, Linux and self-hosted machines issue no Spotlight commands', () => {
  for (const [env, platform] of [
    [{}, 'darwin'],
    [hosted, 'linux'],
    [{ ...hosted, RUNNER_ENVIRONMENT: 'self-hosted' }, 'darwin'],
    ...Object.keys(hosted).map((key) => [{ ...hosted, [key]: '' }, 'darwin']),
  ]) {
    const result = exercise([], env, platform);
    assert.equal(result.verified, false);
    assert.deepEqual(result.calls, []);
    assert.equal(result.events.at(-1).outcome, 'not-ephemeral-macos');
  }
});

test('one bounded Data-volume change precedes a separate exact readback', () => {
  const result = exercise([disabled, disabled]);
  assert.equal(result.verified, true);
  assert.deepEqual(
    result.calls.map(([program, args, options]) => [program, args, options.timeout]),
    [
      [
        '/usr/bin/sudo',
        [
          '-n',
          '/usr/bin/perl',
          '-e',
          result.calls[0][1][3],
          '15',
          '/usr/bin/mdutil',
          '-i',
          'off',
          '/System/Volumes/Data',
        ],
        17000,
      ],
      ['/usr/bin/mdutil', ['-s', '/System/Volumes/Data'], 5000],
    ],
  );
  assert.ok(result.calls.every(([, , options]) => options.killSignal === 'SIGKILL'));
  assert.equal(result.events.at(-1).outcome, 'disabled-and-verified');
});

test('failure, missing privilege and timeout remain unverified without retry or subsequent queries', () => {
  for (const failure of [
    { status: 1, stderr: 'sudo: a password is required' },
    { status: null, signal: 'SIGKILL', error: { code: 'ETIMEDOUT' } },
    { status: null, error: { code: 'ENOENT' } },
  ]) {
    const result = exercise([failure]);
    assert.equal(result.verified, false);
    assert.equal(result.calls.length, 1);
    assert.equal(result.events.at(-1).outcome, 'attempted-unverified');
    assert.equal(result.events[1].stderr, failure.stderr ?? '');
  }
});

test('readback cannot turn another volume, enabled state or a failed command into success', () => {
  for (const result of [
    { ...disabled, status: 1 },
    { ...disabled, signal: 'SIGKILL' },
    { ...disabled, error: { code: 'ETIMEDOUT' } },
    { status: 0, stdout: '/:\n Indexing disabled.\n' },
    { status: 0, stdout: '/System/Volumes/Data:\n Indexing enabled.\n' },
    { status: 0, stdout: disabled.stdout + '/:\n Indexing disabled.\n' },
  ]) {
    assert.equal(indexingDisabled(result), false);
    assert.equal(exercise([disabled, result]).verified, false);
  }
});

test('the real subprocess deadline terminates an unresponsive command', () => {
  // An inert Node child exercises the actual timeout semantics without invoking sudo or host services.
  const result = spawnSync(
    process.execPath,
    ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],
    { timeout: 200, killSignal: 'SIGKILL', encoding: 'utf8' },
  );
  assert.equal(result.error?.code, 'ETIMEDOUT');
  assert.equal(result.signal, 'SIGKILL');
  assert.equal(result.status, null);
});

test('a timed-out sudo-shaped command terminates its operation before the caller returns', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-spotlight-deadline-'));
  const pidFile = join(directory, 'operation.pid');
  const parent = join(directory, 'parent.cjs');
  const operation = join(directory, 'operation.cjs');
  writeFileSync(
    parent,
    'const child=require("node:child_process").spawn(process.argv[2],process.argv.slice(3),{stdio:"inherit"});child.on("close",(code)=>process.exit(code??125));',
  );
  writeFileSync(
    operation,
    `require("node:fs").writeFileSync(${JSON.stringify(pidFile)},String(process.pid));process.on("SIGTERM",()=>{});setInterval(()=>{},1000);`,
  );
  let pid;
  let outcome;
  t.after(() => {
    // Clean only this fixture's recorded child after a failing characterization of the old code.
    if (pid) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
    rmSync(directory, { recursive: true, force: true });
  });
  const started = performance.now();
  const verified = suppressHostedSpotlight({
    env: hosted,
    platform: 'darwin',
    report() {},
    execute(program, args, options) {
      assert.equal(program, '/usr/bin/sudo');
      // Replace only the privilege launcher and mdutil with inert equivalents. The actual
      // supervisor, when present, still owns its subprocess; use one second for this test.
      const command = args.slice(1);
      const index = command.indexOf('/usr/bin/mdutil');
      assert.ok(index >= 0);
      if (command[0] === '/usr/bin/perl') command[index - 1] = '1';
      command.splice(index, command.length - index, process.execPath, operation);
      outcome = spawnSync(process.execPath, [parent, ...command], {
        ...options,
        timeout: 3000,
      });
      return outcome;
    },
  });
  pid = Number(readFileSync(pidFile, 'utf8'));
  const state = spawnSync('ps', ['-p', String(pid), '-o', 'stat='], {
    encoding: 'utf8',
  }).stdout.trim();
  assert.ok(!state || state.startsWith('Z'), 'timed-out operation is still running');
  assert.ok(performance.now() - started < 5000, 'subprocess wait exceeded its outer bound');
  assert.equal(outcome.status, 124);
  assert.equal(outcome.signal, null);
  assert.equal(verified, false);
});

test('the supervisor preserves a completed operation status and output', () => {
  const command = exercise([disabled, disabled]).calls[0][1].slice(2);
  const index = command.indexOf('/usr/bin/mdutil');
  for (const status of [0, 23]) {
    const args = [
      ...command.slice(0, index),
      process.execPath,
      '-e',
      `console.log('observed');process.exit(${status})`,
    ];
    const result = spawnSync('/usr/bin/perl', args, { encoding: 'utf8', timeout: 2000 });
    assert.equal(result.status, status, result.stderr);
    assert.equal(result.stdout, 'observed\n');
    assert.equal(result.signal, null);
  }
});

test('every native producer and consumer suppresses indexing before dependency extraction', () => {
  const require = createRequire(import.meta.url);
  const yaml = createRequire(require.resolve('eslint/package.json'))('js-yaml');
  const load = (path) => yaml.load(readFileSync(path, 'utf8'));
  const stages = [
    load('.github/actions/ios-native-toolchain/action.yml').runs.steps,
    load('.github/workflows/ios-test-cohort-execution.yml').jobs.execution.steps,
    load('.github/workflows/ios-focused.yml').jobs.execution.steps,
  ];
  for (const steps of stages) {
    const suppression = steps.findIndex((step) =>
      step.run?.includes('suppress-hosted-spotlight.mjs'),
    );
    const dependencies = steps.findIndex((step) => step.run?.includes('pnpm install'));
    assert.ok(suppression >= 0 && suppression < dependencies);
    assert.ok(steps[suppression].run.includes('run-command.sh'));
    assert.equal(steps[suppression]['continue-on-error'], undefined);
  }
});
