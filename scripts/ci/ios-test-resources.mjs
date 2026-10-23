import { execFile } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
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

/** Keep host sampling asynchronous and record observer cost without attributing pressure to a process. */
export async function iosTestResourceSnapshot(
  path,
  stage,
  index = 0,
  execute = executeResourceCommand,
  signal,
  {
    skipInitialProcessSnapshot = false,
    skipDuringProcessSnapshot = false,
    skipFinalProcessSnapshot = false,
  } = {},
) {
  const started = performance.now();
  const entry = { stage, index, timestamp: new Date().toISOString(), observations: {} };
  const commandElapsedMs = {};
  for (const [name, program, args] of [
    ['memory', 'vm_stat', []],
    ['swap', 'sysctl', ['vm.swapusage']],
    ['processes', 'ps', ['-axo', 'pid,ppid,%cpu,rss,comm']],
  ]) {
    if (
      name === 'processes' &&
      ((stage === 'before' && skipInitialProcessSnapshot) ||
        (stage === 'during' && skipDuringProcessSnapshot) ||
        (stage === 'after' && skipFinalProcessSnapshot))
    ) {
      entry.observations[name] = {
        unavailable: {
          before: 'process snapshot skipped before XCTest launch',
          during: 'periodic process snapshot skipped to avoid blocking sampler shutdown',
          after: 'process snapshot skipped after readiness or test success',
        }[stage],
      };
      commandElapsedMs[name] = null;
      continue;
    }
    if (signal?.aborted) {
      entry.observations[name] = { unavailable: 'sampling stopped' };
      commandElapsedMs[name] = null;
      continue;
    }
    const commandStarted = performance.now();
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
    } finally {
      // Monotonic command times separate slow host queries from sampler scheduling gaps.
      commandElapsedMs[name] = Math.round((performance.now() - commandStarted) * 1000) / 1000;
    }
  }
  entry.completedAt = new Date().toISOString();
  entry.elapsedMs = Math.round((performance.now() - started) * 1000) / 1000;
  entry.commandElapsedMs = commandElapsedMs;
  appendFileSync(path, JSON.stringify(entry) + '\n');
}

/**
 * Capture sequential samples so telemetry never blocks runner callbacks or overlaps its own host queries.
 * Callers await the initial sample and stop callback to keep the sidecar ordered and reap pending commands.
 * A caller may omit the initial process listing before XCTest when boot sampling already captured host state.
 * A caller may omit periodic process listings while a boot or test process runs, preserving memory/swap
 * samples while avoiding a slow `ps` child holding the final sample behind its close event. Callers may also
 * omit the final process listing after success while retaining it on failure.
 */
export async function iosTestResourceSampler(
  path,
  {
    intervalMs = 20000,
    execute = executeResourceCommand,
    skipInitialProcessSnapshot = false,
    skipDuringProcessSnapshot = false,
    skipFinalProcessSnapshot = false,
  } = {},
) {
  let index = 0;
  let stopped = false;
  let timer;
  let activeController;
  let activeSample;
  let failure;
  let stopPromise;
  const defaultSkipFinalProcessSnapshot = skipFinalProcessSnapshot;

  const sample = (stage, finalSampleOptions = {}) => {
    const controller = new AbortController();
    activeController = controller;
    const pending = iosTestResourceSnapshot(path, stage, index++, execute, controller.signal, {
      skipInitialProcessSnapshot,
      skipDuringProcessSnapshot,
      skipFinalProcessSnapshot:
        finalSampleOptions.skipFinalProcessSnapshot ?? defaultSkipFinalProcessSnapshot,
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

  return ({ skipFinalProcessSnapshot: skipFinal = defaultSkipFinalProcessSnapshot } = {}) => {
    if (stopPromise) return stopPromise;
    stopped = true;
    clearTimeout(timer);
    activeController?.abort();
    stopPromise = (async () => {
      if (activeSample) await activeSample;
      if (failure) throw failure;
      await sample('after', { skipFinalProcessSnapshot: skipFinal });
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
