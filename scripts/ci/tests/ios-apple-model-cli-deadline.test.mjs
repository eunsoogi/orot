import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { inspectAppleModelCliConsent } from '../apple-model-cli-consent.mjs';

const notice = `LEGAL NOTICE & TERMS

PLEASE READ THESE TERMS CAREFULLY BEFORE USING THE APPLE FOUNDATION MODELS CLI. BY
USING THE APPLE FOUNDATION MODELS CLI, YOU ARE AGREEING TO BE BOUND BY THE TERMS OF
THE APPLICABLE SOFTWARE LICENSE AGREEMENT FOR macOS AT
https://www.apple.com/legal/sla/. YOU ARE ALSO AGREEING TO NOT PROGRAMMATICALLY
ACCESS OR USE APPLE MODELS THROUGH APPLE SOFTWARE OR SERVICES EXCEPT AS EXPRESSLY
PERMITTED. IF YOU DO NOT AGREE TO THESE TERMS, DO NOT USE THE APPLE FOUNDATION
MODELS CLI.
`;

test('the real acceptance deadline stops a TERM-resistant child and consumes without retry', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-fm-deadline-'));
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
  };
  const child =
    "process.on('SIGTERM', () => {}); console.log(process.pid); setTimeout(() => process.exit(0), 6500);";
  let attempted = 0;
  const options = {
    consentRunId: '12345',
    env,
    readBinary: () => Buffer.from('inert-binary'),
    execute(command, args, settings) {
      if (args[1] === '--show') return { status: 0, stdout: notice };
      if (args[1] === '--status') return { status: 69, stdout: 'Not agreed\n' };
      if (command !== '/usr/bin/sudo') return { status: 0, stdout: 'observed\n' };
      attempted += 1;
      // Never invoke sudo or fm. Substitute only the fixed child in the real watchdog program.
      if (args[1] === '/usr/bin/fm') return spawnSync(process.execPath, ['-e', child], settings);
      assert.equal(args[1], process.execPath);
      const program = args[4].replace(
        "'/usr/bin/fm', ['license']",
        `${JSON.stringify(process.execPath)}, ['-e', ${JSON.stringify(child)}]`,
      );
      assert.notEqual(program, args[4]);
      return spawnSync(process.execPath, [args[2], args[3], program, args[5]], settings);
    },
  };
  const started = Date.now();
  const report = inspectAppleModelCliConsent(options);
  const elapsedMs = Date.now() - started;
  t.diagnostic(JSON.stringify({ elapsedMs, attempted, actualPrivilegedCommandsExecuted: 0 }));
  assert.ok(elapsedMs < 5500, `acceptance exceeded its bounded deadline: ${elapsedMs}ms`);
  assert.equal(report.consumed, true);
  assert.match(report.error, /did not establish/);
  const acceptance = report.calls.find((call) => call.name === 'license-acceptance');
  const nested = JSON.parse(acceptance.stdout);
  assert.equal(nested.signal, 'SIGKILL');
  assert.equal(nested.error, 'ETIMEDOUT');
  const childPid = Number(nested.stdout.trim());
  assert.throws(() => process.kill(childPid, 0), { code: 'ESRCH' });
  assert.match(inspectAppleModelCliConsent(options).error, /EEXIST/);
  assert.equal(attempted, 1);
});
