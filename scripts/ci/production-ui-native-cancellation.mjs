import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { runOwned } from './production-ui-cancellation.mjs';
import { startProductionCancellationProbe } from './production-ui-cancellation-probe.mjs';
import { readProcessSnapshot } from './ios-test-owned-process-supervisor.mjs';

function executable(row, path) {
  try {
    return realpathSync(row.command) === realpathSync(path);
  } catch {
    return false;
  }
}

/** Cancel only after an authenticated XCTest readiness frame and preserve pre-close process evidence. */
export async function runProductionCancellationProbe(
  { runnerPath, appPath, prepare },
  {
    startProbe = startProductionCancellationProbe,
    runChild = runOwned,
    snapshot = readProcessSnapshot,
    matchesExecutable = executable,
  } = {},
) {
  let owned;
  let ready;
  let observedError;
  let xcodeIdentity;
  const probe = await startProbe({
    onReady({ runnerPid }) {
      if (!owned) throw new Error('Xcode process ownership is unavailable');
      const rows = snapshot();
      const xcode = rows.find((row) => row.pid === owned.pid && row.group === owned.pid);
      const runner = rows.find(
        (row) =>
          row.pid === runnerPid && matchesExecutable(row, join(runnerPath, 'OrotUITests-Runner')),
      );
      const apps = rows.filter((row) => matchesExecutable(row, join(appPath, 'Orot')));
      if (!xcode || xcode.identity !== xcodeIdentity || !runner || apps.length !== 1)
        throw new Error('Owned Xcode, runner or app identity is unavailable');
      if ([xcode, runner, apps[0]].some((row) => row.state.startsWith('Z')))
        throw new Error('Owned process is no longer running at readiness');
      ready = {
        runner: { pid: runner.pid, identity: runner.identity },
        app: { pid: apps[0].pid, identity: apps[0].identity },
        axSnapshot: 'completed-before-ready',
      };
      console.log(
        JSON.stringify({
          stage: 'cancellation_probe_ready',
          xcodePid: owned.pid,
          xcodeIdentity,
          ...ready,
        }),
      );
      probe.markCancellationRequested();
      owned.cancel('SIGINT');
    },
    onFailure(error) {
      observedError ??= error;
      owned?.cancel('SIGTERM');
    },
  });
  try {
    const args = prepare({ port: probe.port, token: probe.token });
    const result = await runChild('xcodebuild', args, {
      onSpawn(handle) {
        owned = handle;
        const row = snapshot().find((item) => item.pid === handle.pid && item.group === handle.pid);
        if (!row) throw new Error('Owned Xcode process group is unavailable');
        xcodeIdentity = row.identity;
      },
    });
    const rows = snapshot();
    const group = rows
      .filter((row) => row.group === owned?.pid && !row.state.startsWith('Z'))
      .map((row) => ({ pid: row.pid, identity: row.identity }));
    const runnerAlive =
      !!ready &&
      rows.some(
        (row) =>
          row.pid === ready.runner.pid &&
          row.identity === ready.runner.identity &&
          !row.state.startsWith('Z'),
      );
    const appAlive =
      !!ready &&
      rows.some(
        (row) =>
          row.pid === ready.app.pid &&
          row.identity === ready.app.identity &&
          !row.state.startsWith('Z'),
      );
    const evidence = {
      stage: 'cancellation_probe_stopped',
      result,
      group,
      runnerAlive,
      appAlive,
      ownedAxRequest: ready && !runnerAlive ? 'completed-before-cancellation' : 'unknown',
    };
    console.log(JSON.stringify(evidence));
    if (
      observedError ||
      probe.failure ||
      !ready ||
      result.cancellation !== 'SIGINT' ||
      result.code === 0 ||
      group.length ||
      runnerAlive
    )
      throw new Error('Native cancellation cleanup did not meet the probe contract');
    // The app may remain running until the disposable simulator is shut down.
    return evidence;
  } finally {
    await probe.close();
  }
}
