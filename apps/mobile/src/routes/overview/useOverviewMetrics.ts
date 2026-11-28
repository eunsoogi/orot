import { useCallback, useEffect, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { AppState } from 'react-native';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import { subscribeWorkoutImportCommitted } from '../../healthkit/workoutImportEvents';
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
import type { OverviewMetricProjection } from './metricProjection';
declare const require: (
  path: '../../storage/secureDatabase',
) => typeof import('../../storage/secureDatabase');
const discardedReadRetryDelays = [100, 300] as const;
const isForeground = () => AppState.currentState === 'active';
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
  const [protectedDataLocked, setProtectedDataLocked] = useState(false);
  const selectionGeneration = useRef(0);
  const loadGeneration = useRef(0);
  const hasSnapshot = useRef(false);
  const reads = useRef(0);
  const workoutRefreshPending = useRef(false);
  const workoutFocus = useRef(false);
  const deferredRead = useRef<number | undefined>(undefined);
  const retry = useCallback(() => {
    loadGeneration.current += 1;
    setAttempt(value => value + 1);
  }, []);
  const clearSnapshot = useCallback(() => {
    // No previously presented measurements survive this invalidation.
    hasSnapshot.current = false;
    setMetrics({});
    setQuantityTruncated(false);
    setState('loading');
  }, []);
  const invalidateSnapshot = useCallback(() => {
    clearSnapshot();
    retry();
  }, [clearSnapshot, retry]);
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
    // Lock is an authoritative invalidation; opening the app switcher is not.
    const protection = conversationExecutionNative();
    let sawLock = false;
    const unsubscribe = protection?.bridgeAvailable
      ? protection.subscribe(event => {
          if (event.kind !== 'protectedData') return;
          if (!event.available) {
            sawLock = true;
            loadGeneration.current++;
            clearSnapshot();
          } else if (sawLock) {
            sawLock = false;
            // Same-tick lock/unlock still invalidates the old generation.
            retry();
          }
          setProtectedDataLocked(!event.available);
        })
      : undefined;
    return () => unsubscribe?.();
  }, [clearSnapshot, retry]);
  useEffect(() => {
    if (!focused || protectedDataLocked) return;
    const subscription = AppState.addEventListener('change', phase => {
      // Resume only interrupted work or a genuine committed change, not a settled snapshot.
      if (phase !== 'active' || deferredRead.current === undefined) return;
      retry();
    });
    return () => subscription.remove();
  }, [focused, protectedDataLocked, retry]);
  useEffect(() => {
    if (!focused) return;
    workoutFocus.current = true;
    const unsubscribe = subscribeWorkoutImportCommitted(() => {
      if (!isForeground() || protectedDataLocked) {
        deferredRead.current ??= 0;
        return;
      }
      if (workoutRefreshPending.current) return;
      // A read already in flight cannot present pre-import rows as current.
      // Let it settle before requesting one successor for coalesced imports.
      if (reads.current > 0) {
        workoutRefreshPending.current = true;
        loadGeneration.current++;
      } else retry();
    });
    return () => {
      workoutFocus.current = false;
      workoutRefreshPending.current = false;
      unsubscribe();
    };
  }, [focused, protectedDataLocked, retry]);
  useEffect(() => {
    if (!focused) return;
    const now = new Date();
    const midnight = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
    );
    const timer = setTimeout(retry, Math.max(1, +midnight - +now));
    return () => clearTimeout(timer);
  }, [focused, attempt, retry]);
  useEffect(() => {
    if (!focused || protectedDataLocked) return;
    if (
      AppState.currentState === 'background' ||
      AppState.currentState === 'inactive'
    ) {
      deferredRead.current ??= 0;
      return;
    }
    const resumeAttempt = deferredRead.current ?? 0;
    deferredRead.current = undefined;
    let active = true;
    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const selectionReadGeneration = selectionGeneration.current;
    const currentLoadGeneration = loadGeneration.current;
    setState(hasSnapshot.current ? 'refreshing' : 'loading');
    const publish = (
      nextSelection: readonly OverviewMetricChoice[],
      nextMetrics: SelectedOverviewSnapshot['chart'],
    ) => {
      if (!active || currentLoadGeneration !== loadGeneration.current) return;
      const selectionIsCurrent =
        selectionReadGeneration === selectionGeneration.current;
      if (selectionIsCurrent) setSelection(nextSelection);
      setMetrics(nextMetrics.metrics);
      setQuantityTruncated(nextMetrics.quantityTruncated);
      hasSnapshot.current = true;
      setState('ready');
    };
    const isCurrent = () =>
      active && currentLoadGeneration === loadGeneration.current;
    const load = async (discardRetries: number) => {
      if (!isCurrent()) return;
      reads.current++;
      try {
        const storage = require('../../storage/secureDatabase');
        const now = new Date();
        const result = await storage.readIsolatedOverview?.(
          now,
          controller.signal,
          ({ selection: isolatedSelection, chart }) =>
            publish(isolatedSelection, chart),
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
            setState('failed');
          } else {
            setState('loading');
            retryTimer = setTimeout(() => {
              if (
                AppState.currentState !== 'inactive' &&
                AppState.currentState !== 'background'
              )
                load(discardRetries + 1);
              else if (isCurrent()) deferredRead.current = discardRetries + 1;
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
        publish(snapshot.selection, snapshot.chart);
      } catch {
        if (isCurrent()) {
          setState(hasSnapshot.current ? 'stale' : 'failed');
        }
      } finally {
        reads.current--;
        if (reads.current === 0 && workoutRefreshPending.current) {
          workoutRefreshPending.current = false;
          if (workoutFocus.current) {
            if (isForeground()) retry();
            else deferredRead.current ??= 0;
          }
        }
      }
    };
    Promise.resolve().then(() => load(resumeAttempt));
    return () => {
      active = false;
      clearTimeout(retryTimer);
      controller.abort();
    };
  }, [focused, protectedDataLocked, attempt, retry]);
  const save = useCallback(async (next: readonly OverviewMetricChoice[]) => {
    const storage = require('../../storage/secureDatabase');
    await saveOverviewMetricSelection(await storage.openLocalStorage(), next);
    selectionGeneration.current += 1;
    setSelection(next);
  }, []);
  return {
    selection,
    metrics,
    quantityTruncated,
    state,
    retry,
    save,
  };
}
