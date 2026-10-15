import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const dataVolume = '/System/Volumes/Data';

// The deadline must run inside sudo, where it can signal the privileged mdutil process.
// The system Perl/POSIX supervisor creates and owns one process group, kills only that
// group on timeout/cancellation, and reaps its child before returning to sudo. If Perl
// is unavailable, the hosted bootstrap fails with its original diagnostics.
const supervisor = `
use strict;
use warnings;
use POSIX qw(setpgid);
my $seconds = shift @ARGV;
my $pid = fork();
defined $pid or die "Cannot fork Spotlight command: $!";
if ($pid == 0) {
  setpgid(0, 0) == 0 or die "Cannot isolate Spotlight command: $!";
  exec @ARGV or die "Cannot execute Spotlight command: $!";
}
setpgid($pid, $pid);
sub terminate {
  my ($status) = @_;
  kill 'KILL', -$pid;
  waitpid($pid, 0);
  exit $status;
}
$SIG{ALRM} = sub { terminate(124); };
$SIG{TERM} = sub { terminate(143); };
$SIG{INT} = sub { terminate(130); };
$SIG{HUP} = sub { terminate(129); };
alarm $seconds;
waitpid($pid, 0);
my $status = $?;
alarm 0;
exit (($status & 127) ? 128 + ($status & 127) : $status >> 8);
`;

/** The required hosted bootstrap must never change a developer Mac or a persistent self-hosted runner. */
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
 * a deadline because the earlier unbounded mdutil experiment held CI for three minutes.
 * A hosted failure stops preparation with its original diagnostics; it cannot claim verified suppression.
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
    ['-n', '/usr/bin/perl', '-e', supervisor, '15', '/usr/bin/mdutil', '-i', 'off', dataVolume],
    // The inner supervisor owns the 15-second operation limit. This outer guard also
    // bounds failure to start the supervisor; it is not the mdutil cleanup mechanism.
    17000,
  );
  const accepted = mutation.status === 0 && !mutation.signal && !mutation.error;
  const verified =
    accepted && indexingDisabled(invoke('readback', '/usr/bin/mdutil', ['-s', dataVolume], 5000));
  report({
    operation: 'host-spotlight',
    outcome: verified ? 'disabled-and-verified' : 'attempted-unverified',
  });
  if (!verified) throw new Error('Hosted Spotlight suppression was not verified');
  return verified;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  suppressHostedSpotlight();
