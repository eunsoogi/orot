import type { HealthObservationMonthWindow } from '@orot/storage';
import { createRecordRepository } from '@orot/storage';
import { NavigationContext } from '@react-navigation/native';
import { useContext, useLayoutEffect, useState } from 'react';
import { AppState } from 'react-native';
import { conversationExecutionNative } from '../ragConversation/conversationExecutionNative';
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
import { workoutReadDiagnostics } from './workoutReadDiagnostics';
import { createWorkoutProtectionProbe } from './workoutProtectionProbe';
import { loadWorkoutPeriodCohort } from './workoutPeriodCohort';
import {
  readWorkoutPeriodHeartRate,
  type WorkoutPeriodResult,
} from './workoutPeriodNativeRead';

type State = WorkoutPeriodResult | { status: 'idle' | 'reading' };
const startupWriterBudgetMs = 2_500;
const trace = workoutReadDiagnostics('records');

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
      trace.report('route', 'started');
      const end = Date.parse(toInclusive);
      const from = Date.parse(fromInclusive);
      if (!Number.isFinite(end) || !Number.isFinite(from) || !(from < end))
        return;
      const period = {
        fromInclusive,
        toExclusive: new Date(end + 1).toISOString(),
      };
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!timeZone) return trace.report('route', 'failed');
      const abort = new AbortController();
      active = abort;
      const owns = () => mounted && active === abort;
      const current = () =>
        owns() &&
        !abort.signal.aborted &&
        visible() &&
        Intl.DateTimeFormat().resolvedOptions().timeZone === timeZone;
      const protection = watchSavedReportNativeProtection(
        abort.signal,
        () => owns() && retire(),
        createWorkoutProtectionProbe(),
        () => accepted !== undefined,
      );
      if (!protection) {
        trace.report('protection', 'missing');
        if (owns()) retire();
        if (mounted && visible()) setState({ status: 'unavailable' });
        return;
      }
      if (!current()) return;
      setState({ status: 'reading' });
      let next: State = { status: 'unavailable' };
      try {
        if (
          !(await trace.observe('protection', protection.confirm)) ||
          !current()
        )
          return;
        const storage = require('../storage/secureDatabase');
        const database = await trace.observe(
          'database',
          storage.openLocalAgentMemoryDatabase,
        );
        if (!current()) return;
        epoch = acquireIndependentReadEpoch(database);
        if (!epoch) {
          trace.report('epoch', 'started');
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
            return trace.report('epoch', 'failed');
          epoch = acquireIndependentReadEpoch(database);
        }
        const sourceCurrent = () =>
          owns() &&
          !abort.signal.aborted &&
          Intl.DateTimeFormat().resolvedOptions().timeZone === timeZone &&
          storage.isCurrentLocalAgentMemoryDatabase(database) &&
          epoch?.current() === true;
        const admitted = () => current() && sourceCurrent();
        if (!admitted()) return trace.report('epoch', 'cancelled');
        const cohort = await trace.observe(
          'cohort',
          () =>
            loadWorkoutPeriodCohort(
              createRecordRepository(database),
              period,
              admitted,
            ),
          admitted,
        );
        if (cohort?.length === 0) trace.report('cohort', 'empty');
        if (
          !cohort ||
          !admitted() ||
          !(await trace.observe('reproof', protection.confirm, admitted)) ||
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
        if (!current()) {
          if (owns()) retire();
        } else {
          setState(next);
          // Only a positively proved snapshot may retain its owner.
          if (!accepted) {
            active = undefined;
            abort.abort();
            epoch?.dispose();
            epoch = undefined;
          }
        }
      }
    }
    function watchRestoration() {
      try {
        return conversationExecutionNative()?.subscribe(event => {
          if (event.kind === 'protectedData' && event.available) read();
        });
      } catch {
        // Only the per-request watcher may authorize a read.
        return undefined;
      }
    }
    const protectionRestored = watchRestoration();
    const visibility = AppState.addEventListener('change', phase => {
      if (phase === 'active') refocus();
      else if (phase === 'inactive' && accepted) setState({ status: 'idle' });
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
    // Focus and a brief inactive phase both need a fresh proof before repaint.
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
    trace.report('route', 'completed');
    read();
    return () => {
      mounted = false;
      retire();
      visibility.remove();
      protectionRestored?.();
      focus?.();
      blur?.();
      clear();
      remove();
      importCommitted();
    };
  }, [fromInclusive, toInclusive, navigation]);
  return state;
}
