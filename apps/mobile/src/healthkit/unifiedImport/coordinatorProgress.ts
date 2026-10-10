import { healthKitFeatures } from '../types';
import type { HealthKitFeature } from '../types';
import type {
  UnifiedFeatureProgress,
  UnifiedFeatureStatus,
  UnifiedEventKitProgress,
  UnifiedImportListeners,
  UnifiedImportMeasurement,
  UnifiedImportProgress,
  UnifiedImportResult,
  UnifiedImportRun,
  UnifiedImportSelection,
} from './types';

export interface ActiveRun {
  readonly selection: UnifiedImportSelection;
  readonly key: string;
  readonly measurementOriginMs: number;
  readonly progressListeners: Set<
    NonNullable<UnifiedImportListeners['onProgress']>
  >;
  readonly measurementListeners: Set<
    NonNullable<UnifiedImportListeners['onMeasurement']>
  >;
  readonly measurements: UnifiedImportMeasurement[];
  progress: UnifiedImportProgress;
  cancelled: boolean;
  finished: boolean;
  eventConfirmationInProgress: boolean;
  eventConfirmationComplete: boolean;
  handle: UnifiedImportRun | null;
}

export function createRun(
  selection: UnifiedImportSelection,
  key: string,
  measurementOriginMs: number,
): ActiveRun {
  const features = Object.fromEntries(
    healthKitFeatures.map(feature => [
      feature,
      {
        status: selection.healthKitFeatures.includes(feature)
          ? 'waitingAuthorization'
          : 'notSelected',
        importedCount: null,
        deletedCount: null,
      } satisfies UnifiedFeatureProgress,
    ]),
  ) as Record<HealthKitFeature, UnifiedFeatureProgress>;
  return {
    selection,
    key,
    measurementOriginMs,
    progressListeners: new Set(),
    measurementListeners: new Set(),
    measurements: [],
    progress: {
      phase: 'queued',
      features,
      eventKit: {
        status: selection.eventKit ? 'waitingAuthorization' : 'notSelected',
        access: null,
        candidates: [],
        appointmentConfirmed: false,
      },
    },
    cancelled: false,
    finished: false,
    eventConfirmationInProgress: false,
    eventConfirmationComplete: false,
    handle: null,
  };
}

export function attachListeners(
  run: ActiveRun,
  listeners: UnifiedImportListeners,
): void {
  if (listeners.onProgress) {
    run.progressListeners.add(listeners.onProgress);
    try {
      listeners.onProgress(copyProgress(run.progress));
    } catch {
      // A screen observer cannot interrupt consent or local import work.
    }
  }
  if (listeners.onMeasurement) {
    run.measurementListeners.add(listeners.onMeasurement);
    for (const measurement of run.measurements) {
      try {
        listeners.onMeasurement(measurement);
      } catch {
        // Metrics callbacks receive no source data and cannot interrupt import.
      }
    }
  }
}

export function setFeature(
  run: ActiveRun,
  feature: HealthKitFeature,
  update: Partial<UnifiedFeatureProgress> & {
    readonly status: UnifiedFeatureStatus;
  },
): void {
  run.progress = {
    ...run.progress,
    features: {
      ...run.progress.features,
      [feature]: { ...run.progress.features[feature], ...update },
    },
  };
  publish(run);
}

export function setEventKit(
  run: ActiveRun,
  update: Partial<UnifiedEventKitProgress> & {
    readonly status: UnifiedEventKitProgress['status'];
  },
): void {
  run.progress = {
    ...run.progress,
    eventKit: { ...run.progress.eventKit, ...update },
  };
  publish(run);
}

export function setPhase(
  run: ActiveRun,
  phase: UnifiedImportProgress['phase'],
): void {
  run.progress = { ...run.progress, phase };
  publish(run);
}

export function publish(run: ActiveRun): void {
  const progress = copyProgress(run.progress);
  for (const listener of run.progressListeners) {
    try {
      listener(progress);
    } catch {
      // A screen observer cannot interrupt consent or local import work.
    }
  }
}

export function recordMeasurement(
  run: ActiveRun,
  measurement: Omit<UnifiedImportMeasurement, 'offsetMs'>,
  now: () => number,
): void {
  const event = {
    ...measurement,
    // Relative offsets support phase-gap analysis without exposing wall-clock time.
    offsetMs: elapsedMilliseconds(run.measurementOriginMs, now()),
  };
  run.measurements.push(event);
  for (const listener of run.measurementListeners) {
    try {
      listener(event);
    } catch {
      // Metrics callbacks receive no source data and cannot interrupt import.
    }
  }
}

export function makeResult(run: ActiveRun): UnifiedImportResult {
  return {
    status: run.progress.phase as UnifiedImportResult['status'],
    readAuthorization: 'notObservable',
    progress: copyProgress(run.progress),
    measurements: [...run.measurements],
  };
}

function copyProgress(progress: UnifiedImportProgress): UnifiedImportProgress {
  return {
    ...progress,
    features: { ...progress.features },
    eventKit: {
      ...progress.eventKit,
      candidates: [...progress.eventKit.candidates],
    },
  };
}

function elapsedMilliseconds(start: number, end: number): number {
  return Math.round(Math.max(0, end - start));
}
