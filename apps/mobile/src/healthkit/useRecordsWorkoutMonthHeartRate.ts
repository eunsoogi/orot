import type { HealthObservationMonthWindow } from '@orot/storage';
import { createRecordRepository } from '@orot/storage';
import { NavigationContext } from '@react-navigation/native';
import { useContext, useLayoutEffect, useState } from 'react';
import { AppState } from 'react-native';
import { watchSavedReportNativeProtection } from '../generatedReports/savedReportNativeProtection';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../storage/localDataClearEvents';
import {
  acquireIndependentReadEpoch,
  awaitIndependentReadSettlement,
} from '../storage/protectedReadEpoch';
import { subscribeWorkoutImportCommitted } from './workoutImportEvents';
import { loadWorkoutPeriodCohort } from './workoutPeriodCohort';
import {
  readWorkoutPeriodHeartRate,
  type WorkoutPeriodResult,
} from './workoutPeriodNativeRead';

type State = WorkoutPeriodResult | { status: 'idle' | 'reading' };
const startupWriterBudgetMs = 2_500;

declare const require: (
  path: '../storage/secureDatabase',
) => Pick<
  typeof import('../storage/secureDatabase'),
  'openLocalAgentMemoryDatabase' | 'isCurrentLocalAgentMemoryDatabase'
>;

/** Workout-category selection owns this local scope. No read while merely listing
 * all categories, and no new permission request when samples are unreadable.
 */
export function useRecordsWorkoutMonthHeartRate({
  fromInclusive,
  toInclusive,
}: HealthObservationMonthWindow): State {
  const navigation = useContext(NavigationContext);
  const [state, setState] = useState<State>({ status: 'idle' });
  useLayoutEffect(() => {
    let mounted = true;
    let active: AbortController | undefined;
    let epoch: ReturnType<typeof acquireIndependentReadEpoch>;
    let accepted:
      | {
          state: WorkoutPeriodResult;
          sourceCurrent: () => boolean;
          confirm: () => Promise<boolean>;
        }
      | undefined;
    const visible = () =>
      AppState.currentState === 'active' && navigation?.isFocused() !== false;
    function retire() {
      active?.abort();
      active = undefined;
      accepted = undefined;
      epoch?.dispose();
      epoch = undefined;
      if (mounted) setState({ status: 'idle' });
    }
    async function read() {
      if (!mounted || active || !visible()) return;
      const end = Date.parse(toInclusive);
      const from = Date.parse(fromInclusive);
      if (!Number.isFinite(end) || !Number.isFinite(from) || !(from < end))
        return;
      // Keep Records' exact inclusive end, expressed as a half-open native bound.
      const period = {
        fromInclusive,
        toExclusive: new Date(end + 1).toISOString(),
      };
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!timeZone) return;
      const abort = new AbortController();
      active = abort;
      const owns = () => mounted && active === abort;
      const current = () =>
        owns() &&
        !abort.signal.aborted &&
        visible() &&
        Intl.DateTimeFormat().resolvedOptions().timeZone === timeZone;
      const protection = watchSavedReportNativeProtection(abort.signal, () => {
        if (owns()) retire();
      });
      if (!protection) {
        if (mounted && visible()) setState({ status: 'unavailable' });
        return;
      }
      if (!current()) return;
      setState({ status: 'reading' });
      let next: State = { status: 'unavailable' };
      try {
        if (!(await protection.confirm()) || !current()) return;
        const storage = require('../storage/secureDatabase');
        const database = await storage.openLocalAgentMemoryDatabase();
        if (!current()) return;
        epoch = acquireIndependentReadEpoch(database);
        // A known local writer blocks admission, not the underlying HealthKit data.
        // Never adopt a new owner or keep an invalidated snapshot after waiting.
        if (!epoch) {
          if (
            !(await awaitIndependentReadSettlement(
              database,
              startupWriterBudgetMs,
              abort.signal,
            )) ||
            !current() ||
            !(await protection.confirm()) ||
            !current() ||
            !storage.isCurrentLocalAgentMemoryDatabase(database)
          )
            return;
          epoch = acquireIndependentReadEpoch(database);
        }
        const sourceCurrent = () =>
          owns() &&
          !abort.signal.aborted &&
          Intl.DateTimeFormat().resolvedOptions().timeZone === timeZone &&
          storage.isCurrentLocalAgentMemoryDatabase(database) &&
          epoch?.current() === true;
        const admitted = () => current() && sourceCurrent();
        const cohort = await loadWorkoutPeriodCohort(
          createRecordRepository(database),
          period,
          admitted,
        );
        if (
          !cohort ||
          !admitted() ||
          !(await protection.confirm()) ||
          !admitted()
        )
          return;
        const value = await readWorkoutPeriodHeartRate(
          period,
          cohort,
          abort.signal,
          { timeZone },
        );
        if (admitted() && (await protection.confirm()) && admitted()) {
          next = value;
          if (value.status === 'available' || value.status === 'emptyVisible')
            accepted = {
              state: value,
              sourceCurrent,
              confirm: protection.confirm,
            };
        }
      } catch {
        // Native/database absence is not evidence for zero workout heart rate.
      } finally {
        if (owns() && !accepted) {
          epoch?.dispose();
          epoch = undefined;
        }
        if (current()) setState(next);
        else if (owns()) retire();
      }
    }
    const visibility = AppState.addEventListener('change', phase => {
      if (phase === 'active') read();
      else retire();
    });
    async function refocus() {
      if (!visible()) return;
      const snapshot = accepted;
      if (!snapshot) {
        read();
        return;
      }
      if (!(await snapshot.confirm()) || accepted !== snapshot || !visible())
        return;
      if (!snapshot.sourceCurrent()) {
        retire();
        read();
        return;
      }
      setState(snapshot.state);
    }
    // A normal in-app blur hides data immediately. Only an already-owned, still
    // current snapshot can be redisplayed, after rechecking native protection.
    const focus = navigation?.addListener('focus', refocus);
    const blur = navigation?.addListener('blur', () => {
      if (accepted) setState({ status: 'idle' });
      else retire();
    });
    const clear = subscribeLocalDataClear(retire);
    const remove = subscribeLocalSourceDeletion(retire);
    const importCommitted = subscribeWorkoutImportCommitted(() => {
      // New/deleted workout identities make both cached and in-flight witnesses stale.
      retire();
      read();
    });
    read();
    return () => {
      mounted = false;
      retire();
      visibility.remove();
      focus?.();
      blur?.();
      clear();
      remove();
      importCommitted();
    };
  }, [fromInclusive, toInclusive, navigation]);
  return state;
}
