import { useLayoutEffect, useState } from 'react';
import { createRecordRepository } from '@orot/storage';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import { subscribeWorkoutImportCommitted } from '../../healthkit/workoutImportEvents';
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
type Epoch = ReturnType<typeof acquireIndependentReadEpoch>;
type ReadOwner = {
  abort: AbortController;
  epoch?: Epoch;
  foreground?: (isActive: boolean) => void;
  settled?: boolean;
  interrupted?: boolean;
  reconfirming?: boolean;
  usable?: () => boolean;
};

declare const require: (
  path: '../../storage/secureDatabase',
) => Pick<
  typeof import('../../storage/secureDatabase'),
  'openLocalAgentMemoryDatabase' | 'isCurrentLocalAgentMemoryDatabase'
>;

/** Brief inactive transitions suspend publication, not an owned same-window read.
 * Background, lock, deletion, or a changed protected owner drops the snapshot.
 */
export function useOverviewWorkoutPeriodHeartRate(active: boolean): State {
  const [state, setState] = useState<State>(unavailable);
  useLayoutEffect(() => {
    const native = active ? conversationExecutionNative() : null;
    if (!native?.bridgeAvailable) {
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
    const waitForForeground = (target: ReadOwner) => {
      if (!current(target)) return Promise.resolve(false);
      if (phase() === 'active') return Promise.resolve(true);
      if (phase() !== 'inactive') return Promise.resolve(false);
      return new Promise<boolean>(resolve => {
        target.foreground = resolve;
      });
    };
    async function confirm(target: ReadOwner) {
      while (await waitForForeground(target)) {
        if (!current(target)) return false;
        const available = await protection.protectedDataAvailable();
        if (!current(target) || available !== true) return false;
        if (phase() === 'active') return true;
      }
      return false;
    }
    async function start(
      canRecover = true,
      previous?: OverviewWorkoutRecovery,
    ) {
      if (!mounted || task || phase() !== 'active') return;
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
        if (!(await confirm(target))) return;
        const storage = require('../../storage/secureDatabase');
        const database = await storage.openLocalAgentMemoryDatabase();
        if (!current(target) || (previous && database !== previous.database))
          return;
        target.epoch = acquireIndependentReadEpoch(database);
        const awaitWriter = () =>
          awaitIndependentReadSettlement(
            database,
            startupWriterBudgetMs,
            target.abort.signal,
          );
        // A known writer is not evidence of no associated heart rate. Wait once,
        // then acquire a fresh snapshot of the same still-authoritative owner.
        if (!target.epoch) {
          if (
            !(await awaitWriter()) ||
            !(await confirm(target)) ||
            !storage.isCurrentLocalAgentMemoryDatabase(database)
          )
            return;
          target.epoch = acquireIndependentReadEpoch(database);
        }
        const scopeCurrent = () =>
          current(target) &&
          currentWindow() &&
          storage.isCurrentLocalAgentMemoryDatabase(database);
        const admitted = () =>
          scopeCurrent() && target.epoch?.current() === true;
        target.usable = admitted;
        if (!admitted()) return;
        const { result } = await readOwnedWorkoutPeriod(period, {
          repository: createRecordRepository(database),
          signal: target.abort.signal,
          current: admitted,
          confirm: () => confirm(target),
          admitNativeCohort: cohortFence.admit,
        });
        if (!admitted()) {
          const cohort = cohortFence.dispatched();
          if (
            cohort &&
            canRecover &&
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
          return;
        }
        if (!result || phase() !== 'active') return;
        target.settled =
          result.status === 'available' || result.status === 'emptyVisible';
        if (target.settled) {
          setState(result);
        } else if (canRecover && target.interrupted) {
          // A brief interruption can cause the original native result to fail
          // after the resume event has already coalesced with this task.
          // Retry once with a fresh ownership/protection check before reading.
          dropTask(false);
          start(false);
        }
      } catch {
        // An incomplete or rejected protected read never publishes an average.
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
          .then(
            valid => {
              if (current(target) && (!valid || target.usable?.() !== true))
                retire();
            },
            () => {
              if (current(target)) retire();
            },
          )
          .finally(() => {
            target.reconfirming = false;
          });
      }
    }
    const unsubscribeProtection = protection.subscribe(event => {
      if (event.kind === 'protectedData' && !event.available) retire();
      else if (event.kind === 'protectedData' || event.kind === 'foreground')
        foreground();
      else if (event.kind === 'phase') {
        if (phase() === 'inactive') {
          inactiveSince ??= Date.now();
          if (task && !task.settled) task.interrupted = true;
        } else if (phase() === 'active') foreground();
        else if (phase() === 'background') {
          retire(false);
          // Drop protected data now, without announcing a failed read before resume.
          setState(loading);
        } else retire();
      }
    });
    const unsubscribeImport = subscribeWorkoutImportCommitted(() => {
      retire();
      start();
    });
    const unsubscribeClear = subscribeLocalDataClear(retire);
    const unsubscribeDelete = subscribeLocalSourceDeletion(() => retire());
    start();
    return () => {
      mounted = false;
      retire();
      unsubscribeProtection();
      unsubscribeImport();
      unsubscribeClear();
      unsubscribeDelete();
    };
  }, [active]);
  return active ? state : unavailable;
}
