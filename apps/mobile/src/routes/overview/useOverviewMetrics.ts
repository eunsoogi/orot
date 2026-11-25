import { useCallback, useEffect, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { AppState } from 'react-native';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../../storage/localDataClearEvents';
import {
  loadSelectedOverviewSnapshot,
  type SelectedOverviewSnapshot,
} from './selectedOverviewSnapshot';
import {
  defaultOverviewMetrics,
  saveOverviewMetricSelection,
  type OverviewMetric,
  type OverviewMetricChoice,
} from './metricSelection';
import {
  workoutChoiceReceiptCurrent,
  type OverviewWorkoutOwnerProps,
  type WorkoutChoiceReceipt,
} from './earlyWorkoutChoice';
import type { OverviewMetricProjection } from './metricProjection';
declare const require: (
  path: '../../storage/secureDatabase',
) => typeof import('../../storage/secureDatabase');
const discardedReadRetryDelays = [100, 300] as const;
/** Reads encrypted local data on entry; selecting metrics never invokes permission or synchronization flows. */
export function useOverviewMetrics() {
  const focused = useIsFocused();
  const [selection, setSelection] = useState<readonly OverviewMetricChoice[]>(
    defaultOverviewMetrics,
  );
  const [metrics, setMetrics] = useState<
    Partial<Record<OverviewMetric, OverviewMetricProjection>>
  >({});
  const [quantityTruncated, setQuantityTruncated] = useState(false);
  const [state, setState] = useState<
    'loading' | 'ready' | 'refreshing' | 'stale' | 'failed'
  >('loading');
  const [attempt, setAttempt] = useState(0);
  const [initialWorkoutChoicePending, setInitialWorkoutChoicePending] =
    useState(true);
  const [workoutSelection, setWorkoutSelection] = useState<{
    epoch: number;
    witness: string | null | undefined;
  } | null>(null);
  const [startupWorkoutChoice, setStartupWorkoutChoice] =
    useState<WorkoutChoiceReceipt>();
  const authenticatedSelection = useRef(0);
  const selectionGeneration = useRef(0);
  const loadGeneration = useRef(0);
  const hasSnapshot = useRef(false);
  const foregroundChoice = useRef(false);
  const [preserveWorkoutOwner, setPreserveWorkoutOwner] = useState(false);
  const retry = useCallback(() => {
    loadGeneration.current += 1;
    setAttempt(value => value + 1);
  }, []);
  const invalidateSnapshot = useCallback(
    (foreground = false) => {
      setWorkoutSelection(null);
      setStartupWorkoutChoice(undefined);
      if (!foreground) foregroundChoice.current = false;
      setPreserveWorkoutOwner(foreground && foregroundChoice.current);
      // No previously presented measurements survive this invalidation.
      hasSnapshot.current = false;
      setMetrics({});
      setQuantityTruncated(false);
      setState('loading');
      retry();
    },
    [retry],
  );
  useEffect(() => {
    const unsubscribeClear = subscribeLocalDataClear(() =>
      invalidateSnapshot(),
    );
    const unsubscribeSourceDeletion = subscribeLocalSourceDeletion(() =>
      invalidateSnapshot(),
    );
    return () => {
      unsubscribeClear();
      unsubscribeSourceDeletion();
    };
  }, [invalidateSnapshot]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', appState => {
      if (appState === 'active') invalidateSnapshot(true);
    });
    return () => subscription.remove();
  }, [invalidateSnapshot]);
  useEffect(() => {
    if (!focused) return;
    const now = new Date();
    const midnight = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
    );
    // Calendar boundaries change the chart and completed comparison windows even without new records.
    const timer = setTimeout(
      retry,
      Math.max(1, midnight.getTime() - now.getTime()),
    );
    return () => clearTimeout(timer);
  }, [focused, attempt, retry, invalidateSnapshot]);
  useEffect(() => {
    if (!focused) {
      foregroundChoice.current = false;
      setPreserveWorkoutOwner(false);
      setWorkoutSelection(null);
      setStartupWorkoutChoice(undefined);
      return;
    }
    let active = true;
    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const selectionReadGeneration = selectionGeneration.current;
    const currentLoadGeneration = loadGeneration.current;
    setState(hasSnapshot.current ? 'refreshing' : 'loading');
    let chartPublished = false;
    const publish = (
      nextSelection: readonly OverviewMetricChoice[],
      nextMetrics: SelectedOverviewSnapshot['chart'],
      choiceWitness?: string | null,
    ) => {
      if (!active || currentLoadGeneration !== loadGeneration.current) return;
      const selectionIsCurrent =
        selectionReadGeneration === selectionGeneration.current;
      if (selectionIsCurrent) setSelection(nextSelection);
      setMetrics(nextMetrics.metrics);
      setQuantityTruncated(nextMetrics.quantityTruncated);
      hasSnapshot.current = true;
      chartPublished = true;
      setInitialWorkoutChoicePending(false);
      setStartupWorkoutChoice(undefined);
      setWorkoutSelection({
        epoch: ++authenticatedSelection.current,
        witness: selectionIsCurrent ? choiceWitness : undefined,
      });

      foregroundChoice.current = true;
      setPreserveWorkoutOwner(false);
      setState('ready');
    };
    const isCurrent = () =>
      active && currentLoadGeneration === loadGeneration.current;
    const load = async (discardRetries: number) => {
      if (!isCurrent()) return;
      try {
        const storage = require('../../storage/secureDatabase');
        const now = new Date();
        if (discardRetries === 0 && authenticatedSelection.current === 0)
          void storage.readIsolatedOverview
            ?.readWorkoutChoice?.(controller.signal, receipt => {
              if (
                isCurrent() &&
                workoutChoiceReceiptCurrent(receipt) &&
                !chartPublished &&
                !controller.signal.aborted &&
                selectionReadGeneration === selectionGeneration.current
              )
                setStartupWorkoutChoice(receipt);
            })
            .catch(() => {});
        const result = await storage.readIsolatedOverview?.(
          now,
          controller.signal,
          ({ selection: isolatedSelection, chart, workoutChoiceWitness }) =>
            publish(isolatedSelection, chart, workoutChoiceWitness),
        );
        if (result === 'published' || controller.signal.aborted) return;
        if (result === 'discarded' || discardRetries > 0) {
          // A revoked or changed snapshot must not leave older values visible.
          if (!isCurrent()) return;
          hasSnapshot.current = false;
          setMetrics({});
          setQuantityTruncated(false);
          const delay = discardedReadRetryDelays[discardRetries];
          if (delay === undefined) {
            foregroundChoice.current = false;
            setPreserveWorkoutOwner(false);
            setStartupWorkoutChoice(undefined);
            setState('failed');
          } else {
            setState('loading');
            retryTimer = setTimeout(() => {
              if (
                AppState.currentState !== 'inactive' &&
                AppState.currentState !== 'background'
              )
                load(discardRetries + 1);
            }, delay);
          }
          return;
        }
        if (!isCurrent()) return;
        const database = await storage.openLocalAgentMemoryDatabase();
        const snapshot = await loadSelectedOverviewSnapshot(
          database,
          now,
          controller.signal,
        );
        publish(
          snapshot.selection,
          snapshot.chart,
          snapshot.workoutChoiceWitness,
        );
      } catch {
        if (isCurrent()) {
          setPreserveWorkoutOwner(false);
          if (!hasSnapshot.current) foregroundChoice.current = false;
          setStartupWorkoutChoice(undefined);
          setState(hasSnapshot.current ? 'stale' : 'failed');
        }
      }
    };
    Promise.resolve().then(() => load(0));
    return () => {
      active = false;
      clearTimeout(retryTimer);
      // Discard queued work and stop only this read at safe SQL boundaries.
      controller.abort();
    };
  }, [focused, attempt]);
  const save = useCallback(async (next: readonly OverviewMetricChoice[]) => {
    const storage = require('../../storage/secureDatabase');
    await saveOverviewMetricSelection(await storage.openLocalStorage(), next);
    selectionGeneration.current += 1;
    setSelection(next);
    setStartupWorkoutChoice(undefined);
  }, []);
  const workoutOwner: OverviewWorkoutOwnerProps = {
    workoutSelectionEpoch: workoutSelection?.epoch ?? null,
    workoutSelectionWitness: workoutSelection?.witness,
    preserveWorkoutOwner,
    startupWorkoutChoice,
    initialWorkoutChoicePending,
  };
  return {
    ...workoutOwner,
    selection,
    metrics,
    quantityTruncated,
    state,
    retry,
    save,
  };
}
