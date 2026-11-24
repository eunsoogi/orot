import { useCallback, useEffect, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { AppState } from 'react-native';
import type { RecordRepository, SqlDatabase } from '@orot/storage';
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
} from './metricSelection';
import type { OverviewMetricProjection } from './metricProjection';

declare const require: (path: string) => {
  openLocalStorage: () => Promise<RecordRepository>;
  openLocalAgentMemoryDatabase: () => Promise<SqlDatabase>;
  readIsolatedOverview?: typeof import('../../storage/secureDatabase').readIsolatedOverview;
};

// A discarded witness can be a concurrent commit or a just-resumed native
// lifecycle. Use fresh leases, never a tight loop or an unguarded fallback.
const discardedReadRetryDelays = [100, 300] as const;

/** Reads encrypted local data on entry; selecting metrics never invokes permission or synchronization flows. */
export function useOverviewMetrics() {
  const focused = useIsFocused();
  const [selection, setSelection] = useState<readonly OverviewMetric[]>(
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
  const selectionGeneration = useRef(0);
  const loadGeneration = useRef(0);
  // Keep the last snapshot only across recoverable retries such as midnight refreshes.
  const hasSnapshot = useRef(false);
  const retry = useCallback(() => {
    // A newer read supersedes unresolved work without discarding a still-valid snapshot.
    loadGeneration.current += 1;
    setAttempt(value => value + 1);
  }, []);
  const invalidateSnapshot = useCallback(() => {
    // A committed clear, source deletion, or OS return can invalidate retained health values.
    hasSnapshot.current = false;
    setMetrics({});
    setQuantityTruncated(false);
    setState('loading');
    retry();
  }, [retry]);
  useEffect(() => {
    const unsubscribeClear = subscribeLocalDataClear(invalidateSnapshot);
    const unsubscribeSourceDeletion =
      subscribeLocalSourceDeletion(invalidateSnapshot);
    return () => {
      unsubscribeClear();
      unsubscribeSourceDeletion();
    };
  }, [invalidateSnapshot]);
  useEffect(() => {
    // Keep access revalidation active while another route is focused in Settings or Health.
    const subscription = AppState.addEventListener('change', appState => {
      if (appState === 'active') invalidateSnapshot();
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
    if (!focused) return;
    let active = true;
    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const selectionReadGeneration = selectionGeneration.current;
    const currentLoadGeneration = loadGeneration.current;
    setState(hasSnapshot.current ? 'refreshing' : 'loading');
    const publish = (
      nextSelection: readonly OverviewMetric[],
      nextMetrics: SelectedOverviewSnapshot['chart'],
    ) => {
      if (!active || currentLoadGeneration !== loadGeneration.current) return;
      if (selectionReadGeneration === selectionGeneration.current)
        setSelection(nextSelection);
      setMetrics(nextMetrics.metrics);
      setQuantityTruncated(nextMetrics.quantityTruncated);
      hasSnapshot.current = true;
      setState('ready');
    };
    const isCurrent = () =>
      active && currentLoadGeneration === loadGeneration.current;
    const load = async (discardRetries: number) => {
      if (!isCurrent()) return;
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
        if (isCurrent()) setState(hasSnapshot.current ? 'stale' : 'failed');
      }
    };
    // Start asynchronously, as before, so immediate effect cleanup can win.
    Promise.resolve().then(() => load(0));
    return () => {
      active = false;
      clearTimeout(retryTimer);
      // Discard queued work and stop only this read at safe SQL boundaries.
      controller.abort();
    };
  }, [focused, attempt]);
  const save = useCallback(async (next: readonly OverviewMetric[]) => {
    const storage = require('../../storage/secureDatabase');
    await saveOverviewMetricSelection(await storage.openLocalStorage(), next);
    // An older refresh may finish after this write; it must not replace the saved choice.
    selectionGeneration.current += 1;
    setSelection(next);
  }, []);
  return { selection, metrics, quantityTruncated, state, retry, save };
}
