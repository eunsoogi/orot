import { useLayoutEffect, useState } from 'react';
import { AppState } from 'react-native';
import { createRecordRepository } from '@orot/storage';
import { watchSavedReportNativeProtection } from '../../generatedReports/savedReportNativeProtection';
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

declare const require: (
  path: '../../storage/secureDatabase',
) => Pick<
  typeof import('../../storage/secureDatabase'),
  'openLocalAgentMemoryDatabase' | 'isCurrentLocalAgentMemoryDatabase'
>;

/** Same seven local chart days as the other Overview cards, with today partial. */
function workoutPeriod(now: Date) {
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - 6);
  return { fromInclusive: from.toISOString(), toExclusive: now.toISOString() };
}

/** Mount only when the user has opted into this metric and the route is focused.
 * Inactive, locked, deleted, or superseded results never reach the card.
 */
export function useOverviewWorkoutPeriodHeartRate(active: boolean): State {
  const [state, setState] = useState<State>(unavailable);
  useLayoutEffect(() => {
    if (!active) {
      setState(unavailable);
      return;
    }
    let mounted = true;
    let task: AbortController | undefined;
    let boundary: ReturnType<typeof setTimeout> | undefined;
    function retire() {
      clearTimeout(boundary);
      boundary = undefined;
      task?.abort();
      task = undefined;
      if (mounted) setState(unavailable);
    }
    async function start() {
      retire();
      const now = new Date();
      // Match Overview’s next wall-clock midnight, not a fixed 24-hour delay.
      // The next window must evict today’s old result even during continuous focus.
      const midnight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
      );
      boundary = setTimeout(
        () => void start(),
        Math.max(1, midnight.getTime() - now.getTime()),
      );
      const abort = new AbortController();
      task = abort;
      const current = () => mounted && task === abort && !abort.signal.aborted;
      const protection = watchSavedReportNativeProtection(abort.signal, () => {
        if (current()) retire();
      });
      if (!protection || !current()) {
        if (current()) retire();
        return;
      }
      setState({ status: 'loading' });
      let epoch: ReturnType<typeof acquireIndependentReadEpoch>;
      try {
        if (!(await protection.confirm()) || !current()) return;
        const storage = require('../../storage/secureDatabase');
        const database = await storage.openLocalAgentMemoryDatabase();
        if (!current()) return;
        epoch = acquireIndependentReadEpoch(database);
        const admitted = () =>
          current() &&
          storage.isCurrentLocalAgentMemoryDatabase(database) &&
          epoch?.current() === true;
        if (!admitted()) return;
        const period = workoutPeriod(now);
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
        const result = await readWorkoutPeriodHeartRate(
          period,
          cohort,
          abort.signal,
        );
        if (admitted() && (await protection.confirm()) && admitted())
          setState(result);
      } catch {
        // An incomplete or rejected protected read never publishes an average.
      } finally {
        epoch?.dispose();
        if (current())
          setState(previous =>
            previous.status === 'loading' ? unavailable : previous,
          );
      }
    }
    const visibility = AppState.addEventListener('change', phase => {
      if (phase === 'active') void start();
      else retire();
    });
    const unsubscribeClear = subscribeLocalDataClear(retire);
    const unsubscribeDelete = subscribeLocalSourceDeletion(retire);
    // The native protected-data watcher admits foreground reads; cached JS
    // AppState may still report unknown on the first mounted frame.
    void start();
    return () => {
      mounted = false;
      retire();
      visibility.remove();
      unsubscribeClear();
      unsubscribeDelete();
    };
  }, [active]);
  return active ? state : unavailable;
}
