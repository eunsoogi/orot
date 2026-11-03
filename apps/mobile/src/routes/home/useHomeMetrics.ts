import { useCallback, useEffect, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { AppState } from 'react-native';
import type { RecordRepository, SqlDatabase } from '@orot/storage';
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
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);
  const selectionGeneration = useRef(0);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
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
    const subscription = AppState.addEventListener('change', appState => {
      if (appState === 'active') retry();
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [focused, attempt, retry]);
  useEffect(() => {
    if (!focused) return;
    let active = true;
    const readGeneration = selectionGeneration.current;
    setState('loading');
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
        if (active) {
          if (readGeneration === selectionGeneration.current)
            setSelection(nextSelection);
          setMetrics(nextMetrics.metrics);
          setQuantityTruncated(nextMetrics.quantityTruncated);
          setState('ready');
        }
      })
      .catch(() => {
        if (active) setState('failed');
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
