import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const dataVolume = '/System/Volumes/Data';

/** This optional host optimization must never change a developer Mac or a persistent self-hosted runner. */
export function isEphemeralMac(env, platform) {
  return (
    platform === 'darwin' &&
    env.CI === 'true' &&
    env.GITHUB_ACTIONS === 'true' &&
    env.RUNNER_OS === 'macOS' &&
    env.RUNNER_ENVIRONMENT === 'github-hosted'
  );
}

/** Require a successful readback for the one intended volume; command acceptance alone is not proof. */
export function indexingDisabled(result) {
  return (
    result.status === 0 &&
    !result.signal &&
    !result.error &&
    /^\/System\/Volumes\/Data:\s*\n\s*Indexing disabled\.?\s*$/.test(result.stdout.trim())
  );
}

/** Suppress competing host indexing once, before dependency extraction, build or Simulator boot.
 * No index deletion, service termination, privilege prompt or retry is allowed. Each invocation has
 * a hard kill deadline because the earlier unbounded mdutil experiment held CI for three minutes.
 * Failure leaves the optimization unverified and preserves all ordinary build/test gates.
 */
export function suppressHostedSpotlight({
  env = process.env,
  platform = process.platform,
  execute = spawnSync,
  report = (value) => console.log(JSON.stringify(value)),
} = {}) {
  if (!isEphemeralMac(env, platform)) {
    report({ operation: 'host-spotlight', outcome: 'not-ephemeral-macos' });
    return false;
  }
  const invoke = (stage, program, args, timeout) => {
    const started = performance.now();
    report({ operation: 'host-spotlight', stage, phase: 'started', program, args });
    const result = execute(program, args, {
      encoding: 'utf8',
      timeout,
      killSignal: 'SIGKILL',
      maxBuffer: 65536,
      env: { ...env, LANG: 'C', LC_ALL: 'C' },
    });
    report({
      operation: 'host-spotlight',
      stage,
      phase: 'finished',
      elapsedMs: Math.round(performance.now() - started),
      status: result.status,
      signal: result.signal,
      error: result.error?.code ?? null,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    });
    return result;
  };
  const mutation = invoke(
    'disable-indexing',
    '/usr/bin/sudo',
    ['-n', '/usr/bin/mdutil', '-i', 'off', dataVolume],
    15000,
  );
  const accepted = mutation.status === 0 && !mutation.signal && !mutation.error;
  const verified =
    accepted && indexingDisabled(invoke('readback', '/usr/bin/mdutil', ['-s', dataVolume], 5000));
  report({
    operation: 'host-spotlight',
    outcome: verified ? 'disabled-and-verified' : 'attempted-unverified',
  });
  return verified;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  suppressHostedSpotlight();
