import {
  createOverviewWorkoutForeground,
  confirmProtection,
  type WorkoutForegroundOwner,
} from './overviewWorkoutForeground';
import { useLayoutEffect, useState } from 'react';
import {
  useOverviewWorkoutSelectionAdmission,
  syncWorkoutChoiceAdoption,
} from './overviewWorkoutSelectionAdmission';
import { createRecordRepository } from '@orot/storage';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import { subscribeWorkoutImportCommitted } from '../../healthkit/workoutImportEvents';
import { workoutReadDiagnostics } from '../../healthkit/workoutReadDiagnostics';
import { createWorkoutProtectionProbe } from '../../healthkit/workoutProtectionProbe';
import {
  readOverviewWorkoutChoicePeriod,
  overviewWorkoutStorage,
} from './readOverviewWorkoutChoicePeriod';
import type { WorkoutChoiceReceipt } from './earlyWorkoutChoice';
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
const trace = workoutReadDiagnostics('overview');
type ReadOwner = WorkoutForegroundOwner & {
  abort: AbortController;
  epoch?: ReturnType<typeof acquireIndependentReadEpoch>;
  stopExpiry?: () => void;
  staleStartup?: boolean;
  receipt?: WorkoutChoiceReceipt;
};
export function useOverviewWorkoutPeriodHeartRate(
  active: boolean,
  selectionEpoch?: number | null,
  startupWorkoutChoice?: WorkoutChoiceReceipt,
  selectionWitness?: string | null,
  readSavedSelection = false,
): State {
  const admission = useOverviewWorkoutSelectionAdmission(
    selectionEpoch,
    startupWorkoutChoice,
    selectionWitness,
  );
  const [state, setState] = useState<State>(unavailable);
  useLayoutEffect(() => {
    const native = active ? conversationExecutionNative() : null;
    if (!native?.bridgeAvailable) {
      if (active) trace.report('protection', 'missing');
      setState(unavailable);
      return;
    }
    const phase = () => native.currentPhase?.() ?? 'unknown';
    let mounted = true;
    let task: ReadOwner | undefined;
    let boundary: ReturnType<typeof setTimeout> | undefined;
    function dropTask(showUnavailable = true) {
      const retired = task;
      task = undefined;
      retired?.foreground?.(false);
      retired?.stopExpiry?.();
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
    const confirm = confirmProtection(current, phase, probe, native);
    async function start(rechecks = 2, previous?: OverviewWorkoutRecovery) {
      if (!mounted || task || phase() !== 'active' || !admission.mayStart())
        return;
      const startup = admission.startup();
      const window = overviewWorkoutReadWindow(previous?.period);
      const { period, currentWindow } = window;
      const cohortFence = overviewWorkoutCohortFence(previous?.cohort);
      const target: ReadOwner = {
        abort: new AbortController(),
        receipt: startup,
      };
      task = target;
      target.stopExpiry = admission.expireProvisional(
        startup,
        () => current(target),
        () => retirePending(),
      );
      clearTimeout(boundary);
      boundary = setTimeout(() => {
        retire();
        start();
      }, window.delay);
      setState(loading);
      try {
        if (!(await trace.observe('protection', () => confirm(target)))) return;
        const storage = overviewWorkoutStorage();
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
          if (
            !(await awaitWriter()) ||
            !(await confirm(target)) ||
            !storage.isCurrentLocalAgentMemoryDatabase(database)
          )
            return trace.report('epoch', 'failed');
          target.epoch = acquireIndependentReadEpoch(database);
        }
        const ownsScope = () =>
          current(target) &&
          currentWindow() &&
          storage.isCurrentLocalAgentMemoryDatabase(database);
        const admitted = () => ownsScope() && target.epoch?.current() === true;
        target.usable = admitted;
        if (!admitted()) return trace.report('epoch', 'cancelled');
        let observedCohort: Parameters<typeof cohortFence.admit>[0] | undefined;
        const { result, stale } = await readOverviewWorkoutChoicePeriod(
          startup,
          period,
          {
            repository: createRecordRepository(database),
            signal: target.abort.signal,
            current: admitted,
            confirm: () => confirm(target),
            readSavedSelection,
            observeReadCohort: cohort => {
              observedCohort = cohort;
            },
            admitNativeCohort: cohortFence.admit,
          },
        );
        target.staleStartup = stale || (!!startup && !admitted());
        target.recover = async () => {
          const dispatched = cohortFence.dispatched();
          const cohort = dispatched ?? observedCohort;
          if (
            cohort &&
            rechecks > (dispatched ? 1 : 0) &&
            (await canReacquireOverviewWorkoutSnapshot(
              target.epoch?.current(),
              () => ownsScope() && phase() === 'active',
              awaitWriter,
              () => confirm(target),
            ))
          ) {
            dropTask(false);
            start(dispatched ? 0 : rechecks - 1, { database, period, cohort });
          }
        };
        const usableResult = !!result && result.status !== 'unavailable';
        while (usableResult && phase() === 'inactive') {
          if (!(await confirm(target))) return;
        }
        if (!admitted()) return await target.recover();
        if (startup && !admission.holds(startup)) {
          target.staleStartup = true;
          return;
        }
        if (!result || phase() !== 'active') return;
        target.settled = usableResult;
        if (target.settled) {
          setState(result);
        } else if (rechecks > 1 && target.interrupted) {
          dropTask(false);
          start(0);
        }
      } catch {
      } finally {
        if (current(target) && !target.settled) {
          dropTask(!target.staleStartup);
          if (startup && admission.startup() !== startup) start(0);
        }
      }
    }
    const unsubscribeProtection = native.subscribe(
      createOverviewWorkoutForeground({
        phase,
        owner: () => task,
        confirm,
        current,
        retire,
        start,
        pause: admission.pause,
        restored: probe.restored,
        pending: () => setState(loading),
      }),
    );
    function onSourceChange() {
      const replacing =
        !!task && (phase() === 'active' || phase() === 'inactive');
      retire(!replacing && !!task);
      if (replacing) setState(loading);
      start();
    }
    const unsubscribeImport = subscribeWorkoutImportCommitted(onSourceChange);
    const unsubscribeClear = subscribeLocalDataClear(retire);
    const unsubscribeDelete = subscribeLocalSourceDeletion(
      readSavedSelection ? onSourceChange : () => retire(),
    );
    const retirePending = () => {
      retire(false);
      setState(loading);
    };
    const stopAdmission = admission.connect(() => {
      if (!syncWorkoutChoiceAdoption(task, phase, admission)) retirePending();
      start();
    });
    if (phase() !== 'active') admission.pause();
    start();
    return () => {
      mounted = false;
      stopAdmission();
      retire();
      unsubscribeProtection();
      unsubscribeImport();
      unsubscribeClear();
      unsubscribeDelete();
    };
  }, [active, admission, readSavedSelection]);
  return active ? state : unavailable;
}
