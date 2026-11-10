import { useCallback, useEffect, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { AppState } from 'react-native';
import type { RecordRepository, SqlDatabase } from '@orot/storage';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../../storage/localDataClearEvents';
import { loadHomeMetrics } from './metricLoader';
import {
  defaultHomeMetrics,
  loadHomeMetricSelection,
  saveHomeMetricSelection,
  type HomeMetric,
} from './metricSelection';
import type { HomeMetricProjection } from './metricProjection';

declare const require: (path: string) => {
  openLocalStorage: () => Promise<RecordRepository>;
  openLocalAgentMemoryDatabase: () => Promise<SqlDatabase>;
};

/** Reads encrypted local data on entry; selecting metrics never invokes permission or synchronization flows. */
export function useHomeMetrics() {
  const focused = useIsFocused();
  const [selection, setSelection] =
    useState<readonly HomeMetric[]>(defaultHomeMetrics);
  const [metrics, setMetrics] = useState<
    Partial<Record<HomeMetric, HomeMetricProjection>>
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
    const selectionReadGeneration = selectionGeneration.current;
    const currentLoadGeneration = loadGeneration.current;
    setState(hasSnapshot.current ? 'refreshing' : 'loading');
    Promise.resolve()
      .then(() => {
        const storage = require('../../storage/secureDatabase');
        return Promise.all([
          storage.openLocalStorage().then(loadHomeMetricSelection),
          storage
            .openLocalAgentMemoryDatabase()
            .then(database => loadHomeMetrics(database)),
        ]);
      })
      .then(([nextSelection, nextMetrics]) => {
        if (active && currentLoadGeneration === loadGeneration.current) {
          if (selectionReadGeneration === selectionGeneration.current)
            setSelection(nextSelection);
          setMetrics(nextMetrics.metrics);
          setQuantityTruncated(nextMetrics.quantityTruncated);
          hasSnapshot.current = true;
          setState('ready');
        }
      })
      .catch(() => {
        if (active && currentLoadGeneration === loadGeneration.current)
          setState(hasSnapshot.current ? 'stale' : 'failed');
      });
    return () => {
      active = false;
    };
  }, [focused, attempt]);
  const save = useCallback(async (next: readonly HomeMetric[]) => {
    const storage = require('../../storage/secureDatabase');
    await saveHomeMetricSelection(await storage.openLocalStorage(), next);
    // An older refresh may finish after this write; it must not replace the saved choice.
    selectionGeneration.current += 1;
    setSelection(next);
  }, []);
  return { selection, metrics, quantityTruncated, state, retry, save };
}
