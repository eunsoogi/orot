import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Apple's macOS 27 CLI defaults to the on-device model. Never select PCC or substitute this observation for app assertions.
const commands = [
  { name: 'help', args: ['--help'], timeout: 5000 },
  { name: 'respond-help', args: ['respond', '--help'], timeout: 5000 },
  {
    name: 'respond',
    args: ['respond', 'Reply with the single word ready.'],
    timeout: 30000,
  },
];

/** Record each distinct command once, including unavailable commands and timeouts. Budgets bound diagnostics, not native test or model-readiness deadlines. */
export function collectAppleModelCliDiagnostics(execute = spawnSync) {
  const calls = commands.map(({ name, args, timeout }) => {
    const started = Date.now();
    let result;
    try {
      result = execute('fm', args, {
        encoding: 'utf8',
        shell: false,
        timeout,
        // Terminate only this owned CLI child on deadline; shared model and native services are untouched.
        killSignal: 'SIGKILL',
        maxBuffer: 4 * 1024 * 1024,
      });
    } catch (error) {
      result = { error };
    }
    return {
      name,
      command: ['fm', ...args],
      timeoutMs: timeout,
      elapsedMs: Date.now() - started,
      exitCode: result.status ?? null,
      signal: result.signal ?? null,
      stdout: String(result.stdout ?? ''),
      stderr: String(result.stderr ?? ''),
      error: result.error
        ? { code: result.error.code ?? null, message: String(result.error.message) }
        : null,
    };
  });
  return {
    scope: 'host-on-device-cli',
    diagnosticOnly: true,
    appAcceptance: false,
    diagnosticPassed: calls.every(
      (call) =>
        call.exitCode === 0 &&
        call.signal === null &&
        call.error === null &&
        (call.name === 'respond' ? call.stdout.trim() : call.stdout.trim() || call.stderr.trim()),
    ),
    calls,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = collectAppleModelCliDiagnostics();
  // Captured UTF-8 stdout/stderr and command errors remain in the always-uploaded log, including output-limit or timeout failures.
  console.log(JSON.stringify(report));
  if (!report.diagnosticPassed) process.exitCode = 1;
}
