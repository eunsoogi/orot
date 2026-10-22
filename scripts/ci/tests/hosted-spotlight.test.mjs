import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { once } from 'node:events';
import { indexingDisabled, suppressHostedSpotlight } from '../suppress-hosted-spotlight.mjs';
import { expandedActionSteps, workflow } from './fixtures/ios-workflow.mjs';

const hosted = {
  CI: 'true',
  GITHUB_ACTIONS: 'true',
  RUNNER_OS: 'macOS',
  RUNNER_ENVIRONMENT: 'github-hosted',
};
const disabled = { status: 0, stdout: '/System/Volumes/Data:\n\tIndexing disabled.\n' };
function exercise(results, env = hosted, platform = 'darwin', expectedFailure = false) {
  const calls = [];
  const events = [];
  const invoke = () =>
    suppressHostedSpotlight({
      env,
      platform,
      execute: (...args) => {
        calls.push(args);
        assert.ok(results.length, 'unexpected extra command or retry');
        return results.shift();
      },
      report: (event) => events.push(event),
    });
  if (expectedFailure) {
    assert.throws(invoke, /Hosted Spotlight suppression was not verified/);
    return { calls, events };
  }
  return { calls, events, verified: invoke() };
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

test('one Data-volume change awaits actual completion before a separate exact readback', () => {
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
          '/usr/bin/mdutil',
          '-i',
          'off',
          '/System/Volumes/Data',
        ],
        undefined,
      ],
      ['/usr/bin/mdutil', ['-s', '/System/Volumes/Data'], undefined],
    ],
  );
  assert.ok(result.calls.every(([, , options]) => options.timeout === undefined));
  assert.equal(result.events.at(-1).outcome, 'disabled-and-verified');
});

test('failure, missing privilege and timeout remain unverified without retry or subsequent queries', () => {
  for (const failure of [
    { status: 1, stderr: 'sudo: a password is required' },
    { status: null, signal: 'SIGKILL', error: { code: 'ETIMEDOUT' } },
    { status: null, error: { code: 'ENOENT' } },
  ]) {
    const result = exercise([failure], hosted, 'darwin', true);
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
    exercise([disabled, result], hosted, 'darwin', true);
  }
});

test('explicit cancellation of the real supervisor reaps only its owned operation', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-spotlight-cancellation-'));
  const operation = join(directory, 'operation.cjs');
  writeFileSync(
    operation,
    'process.on("SIGTERM",()=>{});console.log(process.pid);setInterval(()=>{},1000);',
  );
  const command = exercise([disabled, disabled]).calls[0][1].slice(2);
  const index = command.indexOf('/usr/bin/mdutil');
  const args = [...command.slice(0, index), process.execPath, operation];
  const child = spawn('/usr/bin/perl', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let pid;
  t.after(() => {
    child.kill('SIGKILL');
    if (pid) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
    rmSync(directory, { recursive: true, force: true });
  });
  // Readiness is an event, so a slow fixture cannot consume an unrelated setup budget.
  const [ready] = await once(child.stdout, 'data');
  pid = Number(String(ready).trim());
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  const closed = once(child, 'close');
  child.kill('SIGTERM');
  const [status, signal] = await closed;
  assert.equal(status, 143);
  assert.equal(signal, null);
  const state = spawnSync('ps', ['-p', String(pid), '-o', 'stat='], {
    encoding: 'utf8',
  }).stdout.trim();
  assert.ok(!state || state.startsWith('Z'), 'cancelled operation is still running');
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
    const result = spawnSync('/usr/bin/perl', args, { encoding: 'utf8' });
    assert.equal(result.status, status, result.stderr);
    assert.equal(result.stdout, 'observed\n');
    assert.equal(result.signal, null);
  }
});

test('every native producer and consumer suppresses indexing before dependencies or product download', () => {
  const stages = [
    workflow('.github/workflows/ios-test-products-build.yml').jobs.validation.steps,
    workflow('.github/workflows/ios-production-validation.yml').jobs.validation.steps,
    workflow('.github/workflows/ios-focused.yml').jobs.products.steps,
    ...Object.values(workflow('.github/workflows/ios-debug-tests.yml').jobs).map(
      (job) => job.steps,
    ),
    ...Object.values(workflow('.github/workflows/ios-release-tests.yml').jobs)
      .filter((job) => !job.uses)
      .map((job) => job.steps),
    ...Object.values(workflow('.github/workflows/ios-question-tests.yml').jobs).map(
      (job) => job.steps,
    ),
    workflow('.github/workflows/ios-focused.yml').jobs.execution.steps,
  ].map((steps) =>
    steps.flatMap((step) =>
      step.uses?.startsWith('./.github/actions/')
        ? expandedActionSteps(step.uses + '/action.yml')
        : [step],
    ),
  );
  for (const steps of stages) {
    const suppression = steps.findIndex((step) =>
      step.run?.includes('suppress-hosted-spotlight.mjs'),
    );
    const preparation = steps.findIndex(
      (step) =>
        step.run?.includes('pnpm install') || step.uses?.startsWith('actions/download-artifact@'),
    );
    assert.ok(suppression >= 0 && suppression < preparation);
    assert.ok(steps[suppression].run.includes('run-command.sh'));
    assert.equal(steps[suppression]['continue-on-error'], undefined);
  }
});
