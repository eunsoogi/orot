import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { appleModelCliAcceptanceArguments } from './apple-model-cli-deadline.mjs';

// Exact stdout of the notice the user reviewed. A different notice requires a new decision, not a fallback agreement.
export const APPROVED_FM_NOTICE_SHA256 =
  'c2347c28fdd02ef071d2f952a34749b0e8c1547c4463bbd99229959b3f6d8c93';

/** The approved Linux environment binds consent after its job starts. A retained value cannot authorize another run or attempt. */
export function bindAppleModelCliConsent(configured, env) {
  if (!configured) return '';
  if (!/^\d+$/.test(configured)) throw new Error('CLI consent requires one numeric run ID');
  if (configured !== env.GITHUB_RUN_ID || env.GITHUB_RUN_ATTEMPT !== '1') return '';
  if (
    env.GITHUB_ACTIONS !== 'true' ||
    env.GITHUB_REPOSITORY !== 'eunsoogi/orot' ||
    env.GITHUB_EVENT_NAME !== 'pull_request' ||
    env.GITHUB_REF !== 'refs/pull/200/merge' ||
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '')
  )
    throw new Error('CLI consent does not belong to the intended PR execution');
  return configured;
}

function claimOnce(env, report) {
  if (!isAbsolute(env.RUNNER_TEMP ?? '')) throw new Error('Missing owned runner temporary path');
  const directory = join(env.RUNNER_TEMP, 'orot-fm-cli-consent');
  mkdirSync(directory, { recursive: true });
  // Exclusive creation precedes sudo. Failed acceptance consumes this attempt too; no automatic retry or shared-machine state is used.
  writeFileSync(join(directory, env.GITHUB_RUN_ID + '-1.json'), JSON.stringify(report), {
    flag: 'wx',
    mode: 0o600,
  });
}

/** Capture public provenance without consenting by default. Only the specifically bound hosted Debug job may agree once. */
export function inspectAppleModelCliConsent({
  consentRunId = '',
  env = process.env,
  execute = spawnSync,
  readBinary = readFileSync,
  claim = claimOnce,
} = {}) {
  const report = {
    scope: 'host-cli-consent',
    appAcceptance: false,
    consentRunId,
    runId: env.GITHUB_RUN_ID ?? null,
    attempt: env.GITHUB_RUN_ATTEMPT ?? null,
    testedCommit: env.GITHUB_SHA ?? null,
    job: env.GITHUB_JOB ?? null,
    cohort: env.OROT_NATIVE_COHORT ?? null,
    runnerEnvironment: env.RUNNER_ENVIRONMENT ?? null,
    runnerName: env.RUNNER_NAME ?? null,
    consumed: false,
    acceptedNow: false,
    calls: [],
    error: null,
  };
  function call(name, command, args, input) {
    const started = Date.now();
    const result = execute(command, args, {
      encoding: 'utf8',
      shell: false,
      timeout: 5000,
      killSignal: 'SIGKILL',
      maxBuffer: 1024 * 1024,
      input,
    });
    const observation = {
      name,
      command: [command, ...args],
      elapsedMs: Date.now() - started,
      exitCode: result.status ?? null,
      signal: result.signal ?? null,
      stdout: String(result.stdout ?? ''),
      stderr: String(result.stderr ?? ''),
      error: result.error ? String(result.error.message) : null,
    };
    report.calls.push(observation);
    return observation;
  }
  const succeeded = (result) => result.exitCode === 0 && !result.signal && !result.error;
  try {
    report.binarySha256 = createHash('sha256').update(readBinary('/usr/bin/fm')).digest('hex');
    call('macos', '/usr/bin/sw_vers', []);
    call('xcode', '/usr/bin/xcodebuild', ['-version']);
    call('macos-sdk', '/usr/bin/xcrun', ['--sdk', 'macosx', '--show-sdk-version']);
    call('ios-simulator-sdk', '/usr/bin/xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-version']);
    call('binary-signature', '/usr/bin/codesign', ['--display', '--verbose=2', '/usr/bin/fm']);
    const ptyRuntime = call('pty-runtime', '/usr/bin/python3', [
      '-I',
      '-S',
      '-c',
      'import os, pty, sys; print(sys.version); assert hasattr(os, "waitstatus_to_exitcode") and hasattr(pty, "fork")',
    ]);
    call('license-help', '/usr/bin/fm', ['license', '--help']);
    const notice = call('license-notice', '/usr/bin/fm', ['license', '--show']);
    const before = call('license-status-before', '/usr/bin/fm', ['license', '--status']);
    report.noticeSha256 = createHash('sha256').update(notice.stdout).digest('hex');
    report.alreadyAccepted = succeeded(before);
    if (!consentRunId) return report;
    if (
      bindAppleModelCliConsent(consentRunId, env) !== consentRunId ||
      env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
      env.RUNNER_OS !== 'macOS' ||
      env.GITHUB_JOB !== 'validation' ||
      env.OROT_NATIVE_COHORT !== 'debug'
    )
      throw new Error('CLI consent is restricted to the intended ephemeral hosted Debug job');
    if (!succeeded(notice) || report.noticeSha256 !== APPROVED_FM_NOTICE_SHA256)
      throw new Error('The remote CLI notice differs from the user-approved notice');
    if (before.signal || before.error || ![0, 69].includes(before.exitCode))
      throw new Error('CLI license status could not be determined');
    if (!succeeded(ptyRuntime)) throw new Error('The system PTY runtime is unavailable');
    claim(env, { ...report, consumed: true });
    report.consumed = true;
    let acceptance;
    if (!report.alreadyAccepted) {
      // The fixed privileged watchdog supplies fm's documented yes response and reaps only its own fm child on deadline.
      acceptance = call('license-acceptance', '/usr/bin/sudo', appleModelCliAcceptanceArguments());
    }
    const after = call('license-status-after', '/usr/bin/fm', ['license', '--status']);
    if ((acceptance && !succeeded(acceptance)) || !succeeded(after))
      throw new Error('The one permitted CLI acceptance did not establish accepted status');
    report.acceptedNow = !report.alreadyAccepted;
  } catch (error) {
    report.error = String(error.message ?? error);
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === 'plan') {
    const binding = bindAppleModelCliConsent(
      process.env.OROT_FM_CLI_CONSENT_RUN ?? '',
      process.env,
    );
    if (!process.env.GITHUB_OUTPUT) throw new Error('Consent planning requires workflow outputs');
    appendFileSync(process.env.GITHUB_OUTPUT, 'cli_consent_run_id=' + binding + '\n');
    console.log(JSON.stringify({ consentRunId: binding || null, attempt: '1' }));
  } else if (process.argv[2] === 'inspect') {
    const report = inspectAppleModelCliConsent({
      consentRunId: process.env.OROT_FM_CLI_CONSENT_RUN ?? '',
    });
    console.log(JSON.stringify(report));
    if (report.error) process.exitCode = 1;
  } else
    throw new Error('Use plan or inspect; neither accepts without an exact hosted run binding');
}
