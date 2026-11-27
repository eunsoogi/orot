import {
  createOverviewWorkoutForeground,
  confirmProtection,
  type OverviewWorkoutReadOwner,
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
const unavailable = { status: 'unavailable' } as const;
const loading = { status: 'loading' } as const;
const trace = workoutReadDiagnostics('overview');
export function useOverviewWorkoutPeriodHeartRate(
  active: boolean,
  selectionEpoch?: number | null,
  startupWorkoutChoice?: WorkoutChoiceReceipt,
  selectionWitness?: string | null,
  readSavedSelection = false,
) {
  const admission = useOverviewWorkoutSelectionAdmission(
    selectionEpoch,
    startupWorkoutChoice,
    selectionWitness,
  );
  const [state, setState] = useState<WorkoutPeriodResult | typeof loading>(
    unavailable,
  );
  useLayoutEffect(() => {
    const native = active ? conversationExecutionNative() : null;
    if (!native?.bridgeAvailable) {
      if (active) trace.report('protection', 'missing');
      setState(unavailable);
      return;
    }
    const phase = () => native.currentPhase?.() ?? 'unknown';
    let mounted = true;
    let task: OverviewWorkoutReadOwner | undefined;
    let boundary: ReturnType<typeof setTimeout> | undefined;
    function dropTask(showUnavailable = true) {
      const retired = task;
      task = undefined;
      retired?.foreground?.(false);
      retired?.stopExpiry?.();
      retired?.abort.abort();
      retired?.epoch?.dispose();
      if (mounted && showUnavailable)
        setState(trace.settlement(unavailable, !!retired));
      else if (retired) trace.report('settlement', 'cancelled');
    }
    function retire(showUnavailable = true) {
      clearTimeout(boundary);
      boundary = undefined;
      dropTask(showUnavailable);
    }
    const current = (target: OverviewWorkoutReadOwner) =>
      mounted && task === target && !target.abort.signal.aborted;
    const probe = createWorkoutProtectionProbe();
    const confirm = confirmProtection(current, phase, probe, native);
    async function start(
      retryInterrupted = true,
      previous?: OverviewWorkoutRecovery,
    ) {
      if (!mounted || task || phase() !== 'active' || !admission.mayStart())
        return;
      const startup = admission.startup();
      const window = overviewWorkoutReadWindow(previous?.period);
      const { period, currentWindow } = window;
      const cohortFence = overviewWorkoutCohortFence(previous?.cohort);
      const target: OverviewWorkoutReadOwner = {
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
        const { signal } = target.abort;
        const awaitWriter = () =>
          awaitIndependentReadSettlement(database, undefined, signal);
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
        let observedCohort: Parameters<typeof cohortFence.admit>[0] | undefined;
        target.recover = async () => {
          const cohort =
            cohortFence.dispatched() ?? observedCohort ?? previous?.cohort;
          if (target.recovering || !ownsScope()) return;
          target.recovering = true;
          setState(loading);
          const replacement = await canReacquireOverviewWorkoutSnapshot(
            target.epoch?.current(),
            () => ownsScope() && /^(active|inactive)$/.test(phase()),
            awaitWriter,
            () => confirm(target),
          );
          if (replacement) {
            dropTask(false);
            start(false, { database, period, cohort });
          }
        };
        if (!admitted()) {
          trace.report('epoch', 'cancelled');
          return await target.recover();
        }
        const { result, stale, nativeUnavailable } =
          await readOverviewWorkoutChoicePeriod(startup, period, {
            repository: createRecordRepository(database),
            signal,
            current: admitted,
            confirm: () => confirm(target),
            readSavedSelection,
            observeReadCohort: cohort => {
              observedCohort = cohort;
            },
            admitNativeCohort: cohortFence.admit,
          });
        target.staleStartup = stale || (!!startup && !admitted());
        const usableResult = !!result && result.status !== 'unavailable';
        while (usableResult && phase() === 'inactive') {
          if (!(await confirm(target))) return;
        }
        if (!admitted()) {
          if (!nativeUnavailable) await target.recover();
          return;
        }
        if (startup && !admission.holds(startup)) {
          target.staleStartup = true;
          return;
        }
        if (!result || phase() !== 'active') return;
        target.settled = usableResult;
        if (target.settled) {
          setState(trace.settlement(result));
        } else if (retryInterrupted && target.interrupted) {
          dropTask(false);
          start(false);
        }
      } catch {
      } finally {
        if (current(target) && !target.settled) {
          dropTask(!target.staleStartup);
          if (startup && admission.startup() !== startup) start(false);
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
    if (phase() === 'inactive' || phase() === 'background') setState(loading);
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
