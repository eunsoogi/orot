import { execFile } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const sampleTimeoutMs = 10000;

/** Resolve after execFile and child close; abort kills the sampler child and waits for cleanup. */
export function executeResourceCommand(program, args, { signal } = {}, run = execFile) {
  if (signal?.aborted) return Promise.resolve({ unavailable: 'sampling stopped' });

  return new Promise((resolveResult) => {
    let callbackResult;
    let callbackFinished = false;
    let childClosed = false;
    let abortRequested = false;
    let child;

    const settle = () => {
      if (!callbackFinished || !childClosed) return;
      signal?.removeEventListener('abort', abortChild);
      resolveResult(
        callbackResult.error
          ? { unavailable: String(callbackResult.error) }
          : callbackResult.stdout,
      );
    };
    const abortChild = () => {
      if (abortRequested) return;
      abortRequested = true;
      child.kill('SIGKILL');
    };

    try {
      child = run(
        program,
        args,
        {
          encoding: 'utf8',
          timeout: sampleTimeoutMs,
          killSignal: 'SIGKILL',
          maxBuffer: 1024 * 1024,
        },
        (error, stdout) => {
          callbackResult = { error, stdout };
          callbackFinished = true;
          settle();
        },
      );
      child.once('close', () => {
        childClosed = true;
        settle();
      });
      signal?.addEventListener('abort', abortChild, { once: true });
      if (signal?.aborted) abortChild();
    } catch (error) {
      signal?.removeEventListener('abort', abortChild);
      resolveResult({ unavailable: String(error) });
    }
  });
}

/** Host observations stay nonblocking and do not attribute pressure to a particular process. */
export async function iosTestResourceSnapshot(
  path,
  stage,
  index = 0,
  execute = executeResourceCommand,
  signal,
  { skipDuringProcessSnapshot = false, skipFinalProcessSnapshot = false } = {},
) {
  const entry = { stage, index, timestamp: new Date().toISOString(), observations: {} };
  for (const [name, program, args] of [
    ['memory', 'vm_stat', []],
    ['swap', 'sysctl', ['vm.swapusage']],
    ['processes', 'ps', ['-axo', 'pid,ppid,%cpu,rss,comm']],
  ]) {
    if (
      name === 'processes' &&
      ((stage === 'during' && skipDuringProcessSnapshot) ||
        (stage === 'after' && skipFinalProcessSnapshot))
    ) {
      entry.observations[name] = {
        unavailable:
          stage === 'during'
            ? 'periodic process snapshot skipped during boot or XCTest'
            : 'final process snapshot skipped after successful boot or XCTest',
      };
      continue;
    }
    if (signal?.aborted) {
      entry.observations[name] = { unavailable: 'sampling stopped' };
      continue;
    }
    try {
      entry.observations[name] = await execute(program, args, {
        encoding: 'utf8',
        timeout: sampleTimeoutMs,
        killSignal: 'SIGKILL',
        maxBuffer: 1024 * 1024,
        signal,
      });
    } catch (error) {
      entry.observations[name] = { unavailable: String(error) };
    }
  }
  appendFileSync(path, JSON.stringify(entry) + '\n');
}

/**
 * Capture sequential host samples without overlapping queries. Callers can skip periodic process scans
 * during boot or XCTest, then omit the final process scan only after success; failures retain that evidence.
 */
export async function iosTestResourceSampler(
  path,
  { intervalMs = 20000, execute = executeResourceCommand, skipDuringProcessSnapshot = false } = {},
) {
  let index = 0;
  let stopped = false;
  let timer;
  let activeController;
  let activeSample;
  let failure;
  let stopPromise;

  const sample = (stage, { skipFinalProcessSnapshot = false } = {}) => {
    const controller = new AbortController();
    activeController = controller;
    const pending = iosTestResourceSnapshot(path, stage, index++, execute, controller.signal, {
      skipDuringProcessSnapshot,
      skipFinalProcessSnapshot,
    });
    activeSample = pending;
    return pending.finally(() => {
      if (activeSample === pending) activeSample = undefined;
      if (activeController === controller) activeController = undefined;
    });
  };

  const scheduleNext = () => {
    if (stopped || failure) return;
    timer = setTimeout(() => {
      timer = undefined;
      sample('during').then(scheduleNext, (error) => {
        failure = error;
        stopped = true;
      });
    }, intervalMs);
  };

  await sample('before');
  scheduleNext();

  return ({ skipFinalProcessSnapshot = false } = {}) => {
    if (stopPromise) return stopPromise;
    stopped = true;
    clearTimeout(timer);
    activeController?.abort();
    stopPromise = (async () => {
      if (activeSample) await activeSample;
      if (failure) throw failure;
      await sample('after', { skipFinalProcessSnapshot });
    })();
    return stopPromise;
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [path, stage] = process.argv.slice(2);
  if (!path || !stage) throw new Error('Resource snapshots require an evidence path and stage');
  mkdirSync(dirname(resolve(path)), { recursive: true });
  await iosTestResourceSnapshot(path, stage);
}
