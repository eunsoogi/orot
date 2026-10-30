import { spawn } from 'node:child_process';

/** Verify group signalling with a harmless child before starting a native test. */
export async function cancellationPreflight() {
  const child = spawn(
    process.execPath,
    [
      '-e',
      "process.on('SIGINT', () => process.exit(73)); process.stdout.write('ready\\n'); setInterval(() => {}, 1000)",
    ],
    { detached: true, stdio: ['ignore', 'pipe', 'inherit'] },
  );
  let delivered = false;
  child.stdout.once('data', () => {
    try {
      process.kill(-child.pid, 'SIGINT');
      delivered = true;
    } catch (error) {
      child.kill('SIGKILL');
      child.emit('error', error);
    }
  });
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  if (!delivered || result.code !== 73 || result.signal !== null)
    throw new Error('Owned process group cancellation preflight failed');
  return { signal: 'SIGINT', exitCode: 73 };
}

/** Relay cancellation only to the process group created for this invocation. */
export async function runOwned(
  command,
  args,
  { spawnChild = spawn, signalBus = process, signalGroup = process.kill } = {},
) {
  const child = spawnChild(command, args, { detached: true, stdio: 'inherit' });
  let cancellation;
  let signalError;
  let pendingSignal;
  const interrupt = () => cancel('SIGINT');
  const terminate = () => cancel('SIGTERM');
  function cancel(signal) {
    cancellation ??= signal;
    pendingSignal = signal;
    deliver();
  }
  function deliver() {
    if (!child.pid || !pendingSignal) return;
    try {
      signalGroup(-child.pid, pendingSignal);
    } catch (error) {
      if (error.code !== 'ESRCH') signalError = error;
    }
    pendingSignal = undefined;
  }
  child.once('spawn', deliver);
  signalBus.on('SIGINT', interrupt);
  signalBus.on('SIGTERM', terminate);
  try {
    const result = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal, cancellation }));
    });
    if (signalError) throw signalError;
    return result;
  } finally {
    signalBus.removeListener('SIGINT', interrupt);
    signalBus.removeListener('SIGTERM', terminate);
  }
}
