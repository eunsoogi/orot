import { spawn } from 'node:child_process';

/** Verify group signalling with a harmless child before starting a native test. */
export async function cancellationPreflight({
  spawnChild = spawn,
  signalBus = process,
  signalGroup = process.kill,
} = {}) {
  let child;
  let delivered = false;
  let cancellation;
  let pending;
  let signalError;
  let childError;
  let spawned = false;
  let finished = false;
  const deliver = () => {
    if (!child?.pid || !pending || finished) return;
    try {
      signalGroup(-child.pid, pending);
    } catch (error) {
      signalError = error;
      try {
        if (!child.kill('SIGKILL'))
          signalError = new Error('Preflight child termination was not delivered');
      } catch (killError) {
        signalError = killError;
      }
    }
    pending = undefined;
  };
  const cancel = (signal) => {
    cancellation ??= signal;
    pending = signal;
    deliver();
  };
  const interrupt = () => cancel('SIGINT');
  const terminate = () => cancel('SIGTERM');
  signalBus.on('SIGINT', interrupt);
  signalBus.on('SIGTERM', terminate);
  try {
    child = spawnChild(
      process.execPath,
      [
        '-e',
        "process.on('SIGINT', () => process.exit(73)); process.stdout.write('ready\\n'); setInterval(() => {}, 1000)",
      ],
      { detached: true, stdio: ['ignore', 'pipe', 'inherit'] },
    );
    child.once('spawn', () => {
      spawned = true;
      deliver();
    });
    deliver();
    child.stdout.once('data', () => {
      if (cancellation) return;
      pending = 'SIGINT';
      deliver();
      delivered = !signalError;
    });
    const result = await new Promise((resolve, reject) => {
      child.on('error', (error) => {
        if (!spawned) reject(error);
        else childError ??= error;
      });
      child.once('exit', (code, signal) => {
        finished = true;
        resolve({ code, signal });
      });
    });
    if (
      cancellation ||
      signalError ||
      childError ||
      !delivered ||
      result.code !== 73 ||
      result.signal !== null
    )
      throw new Error('Owned process group cancellation preflight failed');
    return { signal: 'SIGINT', exitCode: 73 };
  } finally {
    signalBus.removeListener('SIGINT', interrupt);
    signalBus.removeListener('SIGTERM', terminate);
  }
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
  let childError;
  let spawned = false;
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
  child.once('spawn', () => {
    spawned = true;
    deliver();
  });
  signalBus.on('SIGINT', interrupt);
  signalBus.on('SIGTERM', terminate);
  try {
    const result = await new Promise((resolve, reject) => {
      child.on('error', (error) => {
        if (!spawned) reject(error);
        else childError ??= error;
      });
      child.once('close', (code, signal) => resolve({ code, signal, cancellation }));
    });
    if (signalError) throw signalError;
    if (childError) throw childError;
    return result;
  } finally {
    signalBus.removeListener('SIGINT', interrupt);
    signalBus.removeListener('SIGTERM', terminate);
  }
}
