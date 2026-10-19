import { spawn } from 'node:child_process';
import { constants as osConstants } from 'node:os';
import { createWarningMarkerScanner } from './warning-marker-scanner.mjs';

const command = process.argv.slice(2);
if (command[0] !== '--' || !command[1])
  throw new Error('Usage: fail-on-warning.mjs -- <command> [arguments...]');

let interruptedSignal;
let spawnFailed = false;
const scanner = createWarningMarkerScanner();

/** Forward raw build output unchanged and make a successful command fail on any warning marker. */
function forwardAndScan(stream, destination, channel) {
  stream.on('data', (chunk) => {
    destination.write(chunk);
    scanner.scan(channel, chunk);
  });
  stream.once('end', () => scanner.flush(channel));
}

const child = spawn(command[1], command.slice(2), {
  stdio: ['inherit', 'pipe', 'pipe'],
});
forwardAndScan(child.stdout, process.stdout, 'stdout');
forwardAndScan(child.stderr, process.stderr, 'stderr');
child.once('error', (error) => {
  spawnFailed = true;
  process.stderr.write(`Failed to start ${command[1]}: ${error.message}\n`);
});
// Keep the wrapper alive until its build child closes so cancellation cannot orphan the build process.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    interruptedSignal ??= signal;
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  });
}
child.once('close', (code, signal) => {
  const exitSignal = interruptedSignal ?? signal;
  const childStatus = spawnFailed
    ? 1
    : exitSignal
      ? 128 + (osConstants.signals[exitSignal] ?? 1)
      : (code ?? 1);
  const passed = childStatus === 0 && scanner.occurrences === 0 && !interruptedSignal;
  process.stderr.write(
    `IOS_WARNING_GATE occurrences=${scanner.occurrences} child_status=${childStatus} signal=${exitSignal ?? 'none'} result=${passed ? 'passed' : 'failed'}\n`,
  );
  process.exitCode = passed ? 0 : childStatus === 0 ? 1 : childStatus;
});
