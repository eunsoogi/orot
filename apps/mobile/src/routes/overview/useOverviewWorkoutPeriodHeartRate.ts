import { useLayoutEffect, useState } from 'react';
import { useOverviewWorkoutSelectionAdmission } from './overviewWorkoutSelectionAdmission';
import { createRecordRepository } from '@orot/storage';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import { subscribeWorkoutImportCommitted } from '../../healthkit/workoutImportEvents';
import { workoutReadDiagnostics } from '../../healthkit/workoutReadDiagnostics';
import { createWorkoutProtectionProbe } from '../../healthkit/workoutProtectionProbe';
import { confirmOverviewWorkoutProtection } from './overviewWorkoutProtection';
import { readOwnedWorkoutPeriod } from '../../healthkit/ownedWorkoutPeriodRead';
import type { WorkoutPeriodResult } from '../../healthkit/workoutPeriodNativeRead';
import {
  canReacquireOverviewWorkoutSnapshot,
  overviewWorkoutReadWindow,
  overviewWorkoutCohortFence,
  type OverviewWorkoutRecovery,
} from './overviewWorkoutSnapshotRecovery';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../../storage/localDataClearEvents';
import {
  acquireIndependentReadEpoch,
  awaitIndependentReadSettlement,
} from '../../storage/protectedReadEpoch';
type State = WorkoutPeriodResult | { status: 'loading' };
const unavailable = { status: 'unavailable' } as const;
const loading = { status: 'loading' } as const;
const startupWriterBudgetMs = 2_500;
const briefInactiveMs = 5_000;
const trace = workoutReadDiagnostics('overview');
type Epoch = ReturnType<typeof acquireIndependentReadEpoch>;
type ReadOwner = {
  abort: AbortController;
  epoch?: Epoch;
  foreground?: (isActive: boolean) => void;
  settled?: boolean;
  interrupted?: boolean;
  reconfirming?: boolean;
  usable?: () => boolean;
  recover?: () => Promise<void>;
};
declare const require: (
  path: '../../storage/secureDatabase',
) => typeof import('../../storage/secureDatabase');
export function useOverviewWorkoutPeriodHeartRate(
  active: boolean,
  selectionEpoch?: number | null,
): State {
  const admission = useOverviewWorkoutSelectionAdmission(selectionEpoch);
  const [state, setState] = useState<State>(unavailable);
  useLayoutEffect(() => {
    trace.report('route', active ? 'started' : 'skipped');
    const native = active ? conversationExecutionNative() : null;
    if (!native?.bridgeAvailable) {
      if (active) trace.report('protection', 'missing');
      setState(unavailable);
      return;
    }
    const protection = native;
    const phase = () => protection.currentPhase?.() ?? 'unknown';
    let mounted = true;
    let task: ReadOwner | undefined;
    let boundary: ReturnType<typeof setTimeout> | undefined;
    let inactiveSince: number | undefined;
    function dropTask(showUnavailable = true) {
      const retired = task;
      task = undefined;
      retired?.foreground?.(false);
      retired?.abort.abort();
      retired?.epoch?.dispose();
      if (mounted && showUnavailable) setState(unavailable);
    }
    function retire(showUnavailable = true) {
      clearTimeout(boundary);
      boundary = undefined;
      dropTask(showUnavailable);
    }
    const current = (target: ReadOwner) =>
      mounted && task === target && !target.abort.signal.aborted;
    const probe = createWorkoutProtectionProbe();
    const confirm = confirmOverviewWorkoutProtection(current, phase, target =>
      probe.confirm(() => current(target), protection.protectedDataAvailable),
    );
    async function start(recheck = true, previous?: OverviewWorkoutRecovery) {
      if (!mounted || task || phase() !== 'active' || !admission.mayStart())
        return;
      trace.report('route', 'completed');
      const window = overviewWorkoutReadWindow(previous?.period);
      const { period, currentWindow } = window;
      const cohortFence = overviewWorkoutCohortFence(previous?.cohort);
      const target: ReadOwner = { abort: new AbortController() };
      task = target;
      clearTimeout(boundary);
      boundary = setTimeout(() => {
        retire();
        start();
      }, window.delay);
      setState(loading);
      try {
        if (!(await trace.observe('protection', () => confirm(target)))) return;
        const storage = require('../../storage/secureDatabase');
        const database = await trace.observe(
          'database',
          storage.openLocalAgentMemoryDatabase,
        );
        if (!current(target) || (previous && database !== previous.database))
          return;
        target.epoch = acquireIndependentReadEpoch(database);
        const awaitWriter = () =>
          awaitIndependentReadSettlement(
            database,
            startupWriterBudgetMs,
            target.abort.signal,
          );
        if (!target.epoch) {
          trace.report('epoch', 'started');
          if (
            !(await awaitWriter()) ||
            !(await confirm(target)) ||
            !storage.isCurrentLocalAgentMemoryDatabase(database)
          )
            return trace.report('epoch', 'failed');
          target.epoch = acquireIndependentReadEpoch(database);
        }
        const scopeCurrent = () =>
          current(target) &&
          currentWindow() &&
          storage.isCurrentLocalAgentMemoryDatabase(database);
        const admitted = () =>
          scopeCurrent() && target.epoch?.current() === true;
        target.usable = admitted;
        if (!admitted()) return trace.report('epoch', 'cancelled');
        let observedCohort: Parameters<typeof cohortFence.admit>[0] | undefined;
        const { result } = await readOwnedWorkoutPeriod(period, {
          repository: createRecordRepository(database),
          signal: target.abort.signal,
          current: admitted,
          confirm: () => confirm(target),
          observeReadCohort: cohort => {
            observedCohort = cohort;
          },
          admitNativeCohort: cohortFence.admit,
        });
        target.recover = async () => {
          const cohort = cohortFence.dispatched() ?? observedCohort;
          if (
            cohort &&
            recheck &&
            (await canReacquireOverviewWorkoutSnapshot(
              target.epoch?.current(),
              () => scopeCurrent() && phase() === 'active',
              awaitWriter,
              () => confirm(target),
            ))
          ) {
            dropTask(false);
            start(false, { database, period, cohort });
          }
        };
        if (!admitted()) return await target.recover();
        if (!result || phase() !== 'active') return;
        target.settled =
          result.status === 'available' || result.status === 'emptyVisible';
        if (target.settled) {
          setState(result);
        } else if (recheck && target.interrupted) {
          dropTask(false);
          start(false);
        }
      } catch {
      } finally {
        if (current(target) && !target.settled) dropTask();
      }
    }
    function foreground() {
      if (phase() !== 'active') return;
      const wasInactive = inactiveSince !== undefined;
      const pausedFor =
        inactiveSince === undefined ? 0 : Date.now() - inactiveSince;
      inactiveSince = undefined;
      if (task && (pausedFor > briefInactiveMs || task.usable?.() === false))
        retire();
      const target = task;
      if (!target) {
        start();
        return;
      }
      const ready = target.foreground;
      target.foreground = undefined;
      ready?.(true);
      if (target.settled && wasInactive && !target.reconfirming) {
        target.reconfirming = true;
        confirm(target)
          .then(async valid => {
            if (valid && current(target) && !target.usable?.()) {
              setState(loading);
              await target.recover?.();
            }
            if (current(target) && (!valid || !target.usable?.())) retire();
          })
          .catch(() => {
            if (current(target)) retire();
          })
          .finally(() => {
            target.reconfirming = false;
          });
      }
    }
    const unsubscribeProtection = protection.subscribe(event => {
      if (event.kind === 'protectedData' && !event.available) retire();
      else if (event.kind === 'protectedData') {
        probe.restored();
        foreground();
      } else if (event.kind === 'foreground') foreground();
      else if (event.kind === 'phase') {
        if (phase() === 'inactive') {
          admission.pause();
          inactiveSince ??= Date.now();
          if (task && !task.settled) task.interrupted = true;
        } else if (phase() === 'active') foreground();
        else if (phase() === 'background') {
          admission.pause();
          retire(false);
          setState(loading);
        } else retire();
      }
    });
    const unsubscribeImport = subscribeWorkoutImportCommitted(() => {
      const replacing =
        !!task && (phase() === 'active' || phase() === 'inactive');
      retire(!replacing && !!task);
      if (replacing) setState(loading);
      start();
    });
    const unsubscribeClear = subscribeLocalDataClear(retire);
    const unsubscribeDelete = subscribeLocalSourceDeletion(() => retire());
    const unbindAdmission = admission.connect(start);
    start();
    return () => {
      mounted = false;
      unbindAdmission();
      retire();
      unsubscribeProtection();
      unsubscribeImport();
      unsubscribeClear();
      unsubscribeDelete();
    };
  }, [active, admission]);
  return active ? state : unavailable;
}
