import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { collectAppleModelCliDiagnostics } from '../probe-apple-model-cli.mjs';

test('host CLI diagnostic records help and exactly one bounded default on-device prompt', () => {
  const invocations = [];
  const report = collectAppleModelCliDiagnostics((command, args, options) => {
    invocations.push({ command, args, options });
    return { status: 0, stdout: args.includes('--help') ? 'Usage: fm' : 'ready\n', stderr: '' };
  });
  assert.deepEqual(
    invocations.map(({ command, args }) => [command, ...args]),
    [
      ['fm', '--help'],
      ['fm', 'respond', '--help'],
      ['fm', 'respond', 'Reply with the single word ready.'],
    ],
  );
  assert.deepEqual(
    invocations.map(({ options }) => options.timeout),
    [5000, 5000, 30000],
  );
  assert.ok(invocations.every(({ options }) => options.shell === false));
  assert.ok(invocations.every(({ options }) => options.killSignal === 'SIGKILL'));
  assert.equal(report.diagnosticOnly, true);
  assert.equal(report.appAcceptance, false);
  assert.equal(report.diagnosticPassed, true);
  assert.equal(report.calls[2].stdout, 'ready\n');
  assert.equal(report.calls[2].exitCode, 0);
});

test('unsupported CLI, absent command, timeout and empty response remain unsuccessful raw evidence', () => {
  for (const result of [
    { status: 1, stdout: '', stderr: 'deviceNotEligible\n' },
    { status: null, error: { code: 'ENOENT', message: 'spawn fm ENOENT' } },
    { status: null, signal: 'SIGTERM', error: { code: 'ETIMEDOUT', message: 'timeout' } },
    { status: 0, stdout: ' \n', stderr: '' },
  ]) {
    let count = 0;
    const report = collectAppleModelCliDiagnostics(() => {
      count += 1;
      return result;
    });
    assert.equal(count, 3);
    assert.equal(report.diagnosticPassed, false);
    assert.equal(report.calls[2].exitCode, result.status);
    assert.equal(report.calls[2].stderr, result.stderr ?? '');
    assert.equal(report.calls[2].signal, result.signal ?? null);
    assert.equal(report.calls[2].error?.code, result.error?.code);
  }
});

test('host diagnostic runs after original attempts and cannot bypass the independent Apple acceptance gate', () => {
  const workflow = readFileSync('.github/workflows/ios-test-cohort-execution.yml', 'utf8');
  const original = workflow.indexOf('- name: Execute every planned first attempt');
  const diagnostic = workflow.indexOf(
    '- name: Record the public on-device Apple model CLI diagnostic',
  );
  const gate = workflow.indexOf('- name: Require supported Apple Intelligence');
  assert.ok(original >= 0 && diagnostic > original && gate > diagnostic);
  const step = workflow.slice(diagnostic, gate);
  assert.match(step, /if: always\(\) && inputs\.cohort == 'debug'/);
  assert.match(step, /probe-apple-model-cli\.mjs/);
  assert.match(step, /artifacts\/ios-cohort\/apple-model-cli\.log/);
  assert.doesNotMatch(step, /continue-on-error|retry|--model/);
  const swift = readFileSync('scripts/ci/prepare-apple-model-host.swift', 'utf8');
  assert.match(swift, /"rawBefore": rawBefore/);
  assert.match(swift, /"rawAfter": String\(reflecting: model\.availability\)/);
  assert.match(swift, /let rawBefore = String\(reflecting: model\.availability\)/);
});

test('real diagnostic entry point exits nonzero when the public command is unavailable', () => {
  // This isolated PATH deliberately contains no fm. It proves error reporting, not hosted model behavior.
  const directory = mkdtempSync(join(tmpdir(), 'orot-apple-cli-absent-'));
  try {
    const result = spawnSync(process.execPath, ['scripts/ci/probe-apple-model-cli.mjs'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: directory },
    });
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    assert.equal(report.diagnosticPassed, false);
    assert.equal(report.appAcceptance, false);
    assert.equal(report.calls.length, 3);
    assert.ok(report.calls.every((call) => call.error.code === 'ENOENT' && call.exitCode === null));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
