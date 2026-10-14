// This fixed program runs under sudo so its hard deadline can terminate and reap
// its own privileged fm child. Killing sudo alone cannot guarantee that cleanup.
// No caller-supplied command, module, shell, PID or model-service name is accepted.
export const FM_LICENSE_WATCHDOG = String.raw`
import { spawnSync } from 'node:child_process';
const deadline = Number(process.argv[1]);
const remaining = deadline - Date.now();
if (!Number.isSafeInteger(deadline) || remaining <= 0 || remaining > 4000) {
  console.error('The owned license deadline expired before execution');
  process.exit(124);
}
const result = spawnSync('/usr/bin/fm', ['license'], {
  input: 'yes\n', encoding: 'utf8', shell: false, timeout: remaining,
  killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
});
console.log(JSON.stringify({
  command: ['/usr/bin/fm', 'license'], exitCode: result.status, signal: result.signal,
  stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? ''),
  error: result.error?.code ?? null,
}));
process.exitCode = result.error?.code === 'ETIMEDOUT' ? 124 : (result.status ?? 1);
`;

/** Reserve one second of the outer five-second limit for reaping and sudo exit. */
export function appleModelCliAcceptanceArguments() {
  return [
    '-n',
    process.execPath,
    '--input-type=module',
    '-e',
    FM_LICENSE_WATCHDOG,
    String(Date.now() + 4000),
  ];
}
