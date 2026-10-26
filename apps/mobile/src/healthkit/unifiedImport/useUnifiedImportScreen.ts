import { useEffect, useRef, useState } from 'react';
import { healthKitFeatures, type HealthKitFeature } from '../types';
import type { UnifiedImportCoordinator } from './HealthKitImportScreen';
import type {
  UnifiedImportMeasurement,
  UnifiedImportProgress,
  UnifiedImportRun,
  UnifiedImportSelection,
} from './types';

/** Keeps provider ordering and run-owned callbacks independent from the presentation. */
export function useUnifiedImportScreen(
  coordinator: UnifiedImportCoordinator,
  onMeasurement?: (measurement: UnifiedImportMeasurement) => void,
  onRunStarted?: () => void,
) {
  const mounted = useRef(true);
  const runGeneration = useRef(0);
  const activeRun = useRef<UnifiedImportRun | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<HealthKitFeature>>(
    new Set(),
  );
  const [eventKitSelected, setEventKitSelected] = useState(false);
  const [progress, setProgress] = useState<UnifiedImportProgress | null>(null);
  const [run, setRun] = useState<UnifiedImportRun | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      runGeneration.current += 1;
      // The shared navigation guard confirms before leaving. Cancel preserves the active atomic page.
      activeRun.current?.cancel();
      activeRun.current = null;
    };
  }, []);

  function resetResult() {
    runGeneration.current += 1;
    setProgress(null);
    setRun(null);
  }

  function toggleFeature(feature: HealthKitFeature) {
    resetResult();
    setSelected(current => {
      const next = new Set(current);
      if (next.has(feature)) next.delete(feature);
      else next.add(feature);
      return next;
    });
  }

  function toggleHealthKit() {
    resetResult();
    setSelected(
      current =>
        new Set(
          current.size === healthKitFeatures.length ? [] : healthKitFeatures,
        ),
    );
  }

  function toggleEventKit() {
    resetResult();
    setEventKitSelected(current => !current);
  }

  function startImport() {
    const selection: UnifiedImportSelection = {
      healthKitFeatures: healthKitFeatures.filter(feature =>
        selected.has(feature),
      ),
      eventKit: eventKitSelected,
    };
    if (
      isRunning ||
      (selection.healthKitFeatures.length === 0 && !selection.eventKit)
    )
      return;
    setProgress(null);
    setRun(null);
    setIsRunning(true);
    const generation = ++runGeneration.current;
    const isCurrentRun = () =>
      mounted.current && runGeneration.current === generation;
    try {
      // Measurement offsets reset per run; stale callbacks cannot publish into a newer session.
      onRunStarted?.();
      const active = coordinator.start(selection, {
        onProgress: value => isCurrentRun() && setProgress(value),
        ...(onMeasurement
          ? { onMeasurement: value => isCurrentRun() && onMeasurement(value) }
          : {}),
      });
      activeRun.current = active;
      setRun(active);
      active.result.then(result => {
        if (!isCurrentRun()) return;
        activeRun.current = null;
        setProgress(result.progress);
        setIsRunning(false);
      });
    } catch {
      setProgress(failedProgress(selection));
      setIsRunning(false);
      setRun(null);
      activeRun.current = null;
    }
  }

  return {
    selected,
    eventKitSelected,
    progress,
    run,
    isRunning,
    revision: runGeneration.current,
    toggleFeature,
    toggleHealthKit,
    toggleEventKit,
    startImport,
  };
}

function failedProgress(
  selection: UnifiedImportSelection,
): UnifiedImportProgress {
  const features = Object.fromEntries(
    healthKitFeatures.map(feature => [
      feature,
      {
        status: selection.healthKitFeatures.includes(feature)
          ? 'failed'
          : 'notSelected',
        importedCount: null,
        deletedCount: null,
      },
    ]),
  ) as UnifiedImportProgress['features'];
  return {
    phase: 'failed',
    features,
    eventKit: {
      status: selection.eventKit ? 'failed' : 'notSelected',
      access: null,
      candidates: [],
      appointmentConfirmed: false,
    },
  };
}
