import { useLayoutEffect, useState } from 'react';
import { createRecordRepository } from '@orot/storage';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import { loadWorkoutPeriodCohort } from '../../healthkit/workoutPeriodCohort';
import {
  readWorkoutPeriodHeartRate,
  type WorkoutPeriodResult,
} from '../../healthkit/workoutPeriodNativeRead';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../../storage/localDataClearEvents';
import { acquireIndependentReadEpoch } from '../../storage/protectedReadEpoch';

type State = WorkoutPeriodResult | { status: 'loading' };
const unavailable = { status: 'unavailable' } as const;
const briefInactiveMs = 5_000;
type Epoch = ReturnType<typeof acquireIndependentReadEpoch>;
type ReadOwner = {
  abort: AbortController;
  epoch?: Epoch;
  foreground?: (isActive: boolean) => void;
  settled?: boolean;
  reconfirming?: boolean;
  usable?: () => boolean;
};

declare const require: (
  path: '../../storage/secureDatabase',
) => Pick<
  typeof import('../../storage/secureDatabase'),
  'openLocalAgentMemoryDatabase' | 'isCurrentLocalAgentMemoryDatabase'
>;

function workoutPeriod(now: Date) {
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - 6);
  return { fromInclusive: from.toISOString(), toExclusive: now.toISOString() };
}

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
    function dropTask() {
      const retired = task;
      task = undefined;
      retired?.foreground?.(false);
      retired?.abort.abort();
      retired?.epoch?.dispose();
      if (mounted) setState(unavailable);
    }
    function retire() {
      clearTimeout(boundary);
      boundary = undefined;
      dropTask();
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
    async function start() {
      if (!mounted || task || phase() !== 'active') return;
      const now = new Date();
      const midnight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
      );
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const target: ReadOwner = { abort: new AbortController() };
      task = target;
      clearTimeout(boundary);
      boundary = setTimeout(
        () => {
          retire();
          start();
        },
        Math.max(1, midnight.getTime() - now.getTime()),
      );
      setState({ status: 'loading' });
      try {
        if (!(await confirm(target))) return;
        const storage = require('../../storage/secureDatabase');
        const database = await storage.openLocalAgentMemoryDatabase();
        if (!current(target)) return;
        target.epoch = acquireIndependentReadEpoch(database);
        const admitted = () =>
          current(target) &&
          Date.now() < midnight.getTime() &&
          zone === Intl.DateTimeFormat().resolvedOptions().timeZone &&
          storage.isCurrentLocalAgentMemoryDatabase(database) &&
          target.epoch?.current() === true;
        target.usable = admitted;
        if (!admitted()) return;
        const period = workoutPeriod(now);
        const cohort = await loadWorkoutPeriodCohort(
          createRecordRepository(database),
          period,
          admitted,
        );
        if (!cohort || !admitted() || !(await confirm(target)) || !admitted())
          return;
        const result = await readWorkoutPeriodHeartRate(
          period,
          cohort,
          target.abort.signal,
        );
        if (!(await confirm(target)) || !admitted() || phase() !== 'active')
          return;
        target.settled =
          result.status === 'available' || result.status === 'emptyVisible';
        if (target.settled) setState(result);
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
        if (phase() === 'inactive') inactiveSince ??= Date.now();
        else if (phase() === 'active') foreground();
        else retire();
      }
    });
    const unsubscribeClear = subscribeLocalDataClear(retire);
    const unsubscribeDelete = subscribeLocalSourceDeletion(retire);
    start();
    return () => {
      mounted = false;
      retire();
      unsubscribeProtection();
      unsubscribeClear();
      unsubscribeDelete();
    };
  }, [active]);
  return active ? state : unavailable;
}
