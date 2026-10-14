import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  APPROVED_FM_NOTICE_SHA256,
  bindAppleModelCliConsent,
  inspectAppleModelCliConsent,
} from '../apple-model-cli-consent.mjs';
import { collectAppleModelCliDiagnostics } from '../probe-apple-model-cli.mjs';
import { FM_LICENSE_WATCHDOG } from '../apple-model-cli-deadline.mjs';

const notice = `LEGAL NOTICE & TERMS

PLEASE READ THESE TERMS CAREFULLY BEFORE USING THE APPLE FOUNDATION MODELS CLI. BY
USING THE APPLE FOUNDATION MODELS CLI, YOU ARE AGREEING TO BE BOUND BY THE TERMS OF
THE APPLICABLE SOFTWARE LICENSE AGREEMENT FOR macOS AT
https://www.apple.com/legal/sla/. YOU ARE ALSO AGREEING TO NOT PROGRAMMATICALLY
ACCESS OR USE APPLE MODELS THROUGH APPLE SOFTWARE OR SERVICES EXCEPT AS EXPRESSLY
PERMITTED. IF YOU DO NOT AGREE TO THESE TERMS, DO NOT USE THE APPLE FOUNDATION
MODELS CLI.
`;

function fixture(t, changes = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-fm-consent-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const env = {
    GITHUB_ACTIONS: 'true',
    GITHUB_RUN_ID: '12345',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_REPOSITORY: 'eunsoogi/orot',
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_REF: 'refs/pull/200/merge',
    GITHUB_SHA: 'a'.repeat(40),
    GITHUB_JOB: 'validation',
    RUNNER_ENVIRONMENT: 'github-hosted',
    RUNNER_OS: 'macOS',
    RUNNER_TEMP: directory,
    OROT_NATIVE_COHORT: 'debug',
    ...changes,
  };
  const calls = [];
  let accepted = false;
  const options = {
    consentRunId: '12345',
    env,
    readBinary: () => Buffer.from('synthetic-system-binary'),
  };
  options.execute = (command, args, settings) => {
    calls.push({ command, args, settings });
    if (command === '/usr/bin/sudo') accepted = true;
    if (args[0] === 'license' && args[1] === '--show') return { status: 0, stdout: notice };
    if (args[0] === 'license' && args[1] === '--status')
      return { status: accepted ? 0 : 69, stdout: accepted ? 'Agreed\n' : 'Not agreed\n' };
    return { status: 0, stdout: 'observed\n' };
  };
  return { options, calls, directory };
}

test('approved notice bytes match the reviewed fingerprint', () => {
  assert.equal(createHash('sha256').update(notice).digest('hex'), APPROVED_FM_NOTICE_SHA256);
});

test('absent or stale environment binding never authorizes another run or attempt', (t) => {
  const { options, calls } = fixture(t);
  assert.equal(bindAppleModelCliConsent('', options.env), '');
  assert.equal(bindAppleModelCliConsent('12344', options.env), '');
  assert.equal(bindAppleModelCliConsent('12345', { ...options.env, GITHUB_RUN_ATTEMPT: '2' }), '');
  assert.throws(() => bindAppleModelCliConsent('12345\nextra', options.env), /numeric/);
  const report = inspectAppleModelCliConsent({ ...options, consentRunId: '' });
  assert.equal(report.error, null);
  assert.equal(report.consumed, false);
  assert.equal(report.acceptedNow, false);
  assert.ok(!calls.some((item) => item.command === '/usr/bin/sudo'));
});

test('one bound hosted invocation consumes before sudo, records accepted status and runs one default response', (t) => {
  const { options, calls, directory } = fixture(t);
  const execute = options.execute;
  options.execute = (command, args, settings) => {
    if (command === '/usr/bin/sudo') {
      const claim = JSON.parse(
        readFileSync(join(directory, 'orot-fm-cli-consent/12345-1.json'), 'utf8'),
      );
      assert.equal(claim.consumed, true);
      assert.equal(claim.noticeSha256, APPROVED_FM_NOTICE_SHA256);
      assert.equal(settings.input, undefined);
      assert.deepEqual(args.slice(0, 5), [
        '-n',
        process.execPath,
        '--input-type=module',
        '-e',
        FM_LICENSE_WATCHDOG,
      ]);
      assert.ok(Number(args[5]) > Date.now() && Number(args[5]) <= Date.now() + 4000);
    }
    return execute(command, args, settings);
  };
  const report = inspectAppleModelCliConsent(options);
  assert.equal(report.error, null);
  assert.equal(report.acceptedNow, true);
  assert.equal(report.appAcceptance, false);
  assert.equal(calls.filter((item) => item.command === '/usr/bin/sudo').length, 1);
  assert.ok(calls.every((item) => item.settings.timeout === 5000 && item.settings.shell === false));
  assert.equal(report.calls.at(-1).name, 'license-status-after');
  assert.equal(report.calls.at(-1).exitCode, 0);
  collectAppleModelCliDiagnostics(options.execute);
  assert.equal(
    calls.filter((item) => item.args[0] === 'respond' && !item.args.includes('--help')).length,
    1,
  );
  assert.ok(!calls.some((item) => item.args.includes('--model')));
  const duplicate = inspectAppleModelCliConsent(options);
  assert.match(duplicate.error, /EEXIST/);
  assert.equal(calls.filter((item) => item.command === '/usr/bin/sudo').length, 1);
});

test('notice, run, attempt, repository, event, host, job and cohort mismatches cannot accept', (t) => {
  for (const changes of [
    { GITHUB_RUN_ID: '54321' },
    { GITHUB_RUN_ATTEMPT: '2' },
    { GITHUB_ACTIONS: '' },
    { GITHUB_REPOSITORY: 'another/repository' },
    { GITHUB_EVENT_NAME: 'workflow_dispatch' },
    { GITHUB_REF: 'refs/pull/201/merge' },
    { GITHUB_SHA: '' },
    { RUNNER_ENVIRONMENT: 'self-hosted' },
    { RUNNER_OS: 'Linux' },
    { GITHUB_JOB: 'another-job' },
    { OROT_NATIVE_COHORT: 'release' },
  ]) {
    const { options, calls } = fixture(t, changes);
    assert.ok(inspectAppleModelCliConsent(options).error, JSON.stringify(changes));
    assert.ok(!calls.some((item) => item.command === '/usr/bin/sudo'));
  }
  const { options, calls } = fixture(t);
  const execute = options.execute;
  options.execute = (command, args, settings) =>
    args[1] === '--show'
      ? { status: 0, stdout: notice + 'changed\n' }
      : execute(command, args, settings);
  assert.match(inspectAppleModelCliConsent(options).error, /differs/);
  assert.ok(!calls.some((item) => item.command === '/usr/bin/sudo'));
});

test('failed or unconfirmed acceptance consumes the attempt without automatic retry', (t) => {
  for (const failure of [
    { status: 1 },
    { status: null, signal: 'SIGTERM', error: new Error('timeout') },
    { status: 0 },
  ]) {
    const { options, calls } = fixture(t);
    const execute = options.execute;
    options.execute = (command, args, settings) => {
      if (command === '/usr/bin/sudo') {
        calls.push({ command, args, settings });
        return failure;
      }
      return execute(command, args, settings);
    };
    const report = inspectAppleModelCliConsent(options);
    assert.match(report.error, /did not establish/);
    assert.equal(report.consumed, true);
    assert.equal(report.acceptedNow, false);
    assert.match(inspectAppleModelCliConsent(options).error, /EEXIST/);
    assert.equal(calls.filter((item) => item.command === '/usr/bin/sudo').length, 1);
  }
});

test('an already accepted runner still consumes once without repeating privileged acceptance', (t) => {
  const { options, calls } = fixture(t);
  const execute = options.execute;
  options.execute = (command, args, settings) =>
    args[1] === '--status' ? { status: 0, stdout: 'Agreed\n' } : execute(command, args, settings);
  const report = inspectAppleModelCliConsent(options);
  assert.equal(report.error, null);
  assert.equal(report.alreadyAccepted, true);
  assert.equal(report.acceptedNow, false);
  assert.equal(report.consumed, true);
  assert.match(inspectAppleModelCliConsent(options).error, /EEXIST/);
  assert.ok(!calls.some((item) => item.command === '/usr/bin/sudo'));
});

test('failed notice or indeterminate license status cannot consume or accept', (t) => {
  for (const [argument, result] of [
    ['--show', { status: 1, stdout: notice }],
    ['--status', { status: 1 }],
    ['--status', { status: null, signal: 'SIGTERM', error: new Error('timeout') }],
  ]) {
    const { options, calls } = fixture(t);
    const execute = options.execute;
    options.execute = (command, args, settings) =>
      args[1] === argument ? result : execute(command, args, settings);
    const report = inspectAppleModelCliConsent(options);
    assert.ok(report.error);
    assert.equal(report.consumed, false);
    assert.ok(!calls.some((item) => item.command === '/usr/bin/sudo'));
  }
});

test('real planning CLI forwards only this first run and nested workflow wiring stays Debug-only', (t) => {
  const { options, directory } = fixture(t);
  const output = join(directory, 'outputs');
  const result = spawnSync(process.execPath, ['scripts/ci/apple-model-cli-consent.mjs', 'plan'], {
    encoding: 'utf8',
    env: { ...options.env, GITHUB_OUTPUT: output, OROT_FM_CLI_CONSENT_RUN: '12345' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(output, 'utf8'), 'cli_consent_run_id=12345\n');
  const workflow = readFileSync('.github/workflows/ios-test-validation.yml', 'utf8');
  assert.match(
    workflow,
    /cli_consent_run_id: \$\{\{ steps\.cli_consent\.outputs\.cli_consent_run_id \}\}/,
  );
  assert.match(workflow, /OROT_FM_CLI_CONSENT_RUN: \$\{\{ vars\.OROT_FM_CLI_CONSENT_RUN \}\}/);
  const debug = workflow.slice(
    workflow.indexOf('  debug_execution:'),
    workflow.indexOf('  release_execution:'),
  );
  assert.match(debug, /cli_consent_run_id: \$\{\{ needs\.plan\.outputs\.cli_consent_run_id \}\}/);
  assert.doesNotMatch(
    workflow.slice(workflow.indexOf('  release_execution:')),
    /cli_consent_run_id/,
  );
  const execution = readFileSync('.github/workflows/ios-test-build-and-execute.yml', 'utf8');
  assert.match(execution, /cli_consent_run_id: \{ required: false, type: string, default: '' \}/);
  assert.match(execution, /cli_consent_run_id: \$\{\{ inputs\.cli_consent_run_id \}\}/);
  assert.match(execution, /timeout-minutes: 2/);
  const action = readFileSync('.github/actions/ios-apple-model-host/action.yml', 'utf8');
  assert.match(action, /steps\.cli_consent\.outcome == 'success'/);
  assert.equal(action.split('probe-apple-model-cli.mjs').length - 1, 1);
  assert.match(action, /verify-apple-model-host\.mjs "\$EVIDENCE\/apple-model-host\.log"/);
  assert.match(
    action,
    /verify-apple-model-host\.mjs "\$EVIDENCE\/apple-model-host-after-cli\.log"/,
  );
});
