import { healthKitFeatures } from '../types';
import type {
  HealthKitAuthorizationResult,
  HealthKitBatchAuthorizationResult,
  HealthKitFeature,
} from '../types';
import type {
  UnifiedFeatureStatus,
  UnifiedImportResult,
  UnifiedImportSelection,
} from './types';
import type { ActiveRun } from './coordinatorProgress';
import { publish, setEventKit, setFeature } from './coordinatorProgress';

export function applyBatchResult(
  run: ActiveRun,
  batch: HealthKitBatchAuthorizationResult,
): void {
  for (const feature of run.selection.healthKitFeatures) {
    setFeature(run, feature, {
      status: statusForAuthorization(batch, feature),
    });
  }
}

export function statusForAuthorization(
  batch: HealthKitBatchAuthorizationResult,
  feature: HealthKitFeature,
): UnifiedFeatureStatus {
  if (batch.availability === 'available') {
    return batch.unsupportedFeatures.includes(feature)
      ? 'unsupportedFeature'
      : 'ready';
  }
  return batch.availability;
}

export function authorizationForFeature(
  batch: HealthKitBatchAuthorizationResult | null,
  feature: HealthKitFeature,
): HealthKitAuthorizationResult {
  if (batch?.availability === 'available') {
    return batch.unsupportedFeatures.includes(feature)
      ? {
          availability: 'unsupportedFeature',
          requestStatus: 'notRequested',
          readAuthorization: 'notObservable',
        }
      : {
          availability: 'available',
          requestStatus: 'completed',
          readAuthorization: 'notObservable',
        };
  }
  if (batch?.availability === 'unsupportedFeature') {
    return {
      availability: 'unsupportedFeature',
      requestStatus: 'notRequested',
      readAuthorization: 'notObservable',
    };
  }
  return {
    availability: batch?.availability ?? 'unavailable',
    requestStatus: 'notRequested',
    readAuthorization: 'notObservable',
  };
}

export function normalizeSelection(
  selection: UnifiedImportSelection,
): UnifiedImportSelection {
  const selected = new Set(selection.healthKitFeatures);
  const eventKit = selection.eventKit ?? false;
  if (
    selected.size !== selection.healthKitFeatures.length ||
    [...selected].some(feature => !healthKitFeatures.includes(feature)) ||
    (selected.size === 0 && !eventKit) ||
    (selection.eventKit !== undefined &&
      typeof selection.eventKit !== 'boolean')
  ) {
    throw new Error('HealthKit import selection is invalid.');
  }
  return {
    healthKitFeatures: healthKitFeatures.filter(feature =>
      selected.has(feature),
    ),
    eventKit,
  };
}

export function cancelRemaining(run: ActiveRun): void {
  for (const feature of run.selection.healthKitFeatures) {
    const status = run.progress.features[feature].status;
    if (status === 'ready' || status === 'waitingAuthorization') {
      setFeature(run, feature, { status: 'cancelled' });
    }
  }
  if (run.selection.eventKit) {
    // Cancelled runs cannot expose candidates for a later confirmation action.
    const status = run.progress.eventKit.status;
    if (
      [
        'waitingAuthorization',
        'authorizing',
        'ready',
        'querying',
        'complete',
        'empty',
      ].includes(status)
    ) {
      setEventKit(run, { status: 'cancelled', candidates: [] });
    }
  }
}

export function requestCancel(run: ActiveRun): void {
  if (run.finished || run.cancelled) return;
  run.cancelled = true;
  run.progress = { ...run.progress, phase: 'cancelling' };
  publish(run);
}

export function finish(run: ActiveRun): void {
  const statuses = run.selection.healthKitFeatures.map(
    feature => run.progress.features[feature].status,
  );
  const eventStatus = run.progress.eventKit.status;
  const eventSucceeded = eventStatus === 'complete' || eventStatus === 'empty';
  const eventSelected = run.selection.eventKit === true;
  const hasCancelled =
    run.cancelled ||
    statuses.includes('cancelled') ||
    eventStatus === 'cancelled';
  const hasFailure =
    statuses.includes('failed') || (eventSelected && eventStatus === 'failed');
  // A provider denial or failure stays visible while another selected provider can succeed.
  const hasIssue =
    statuses.some(isIssueStatus) || (eventSelected && !eventSucceeded);
  const hasSuccess = statuses.some(isSuccessStatus) || eventSucceeded;
  const hasChanges = run.selection.healthKitFeatures.some(feature => {
    const value = run.progress.features[feature];
    return (value.importedCount ?? 0) + (value.deletedCount ?? 0) > 0;
  });
  const hasResults = hasChanges || run.progress.eventKit.candidates.length > 0;
  const status: UnifiedImportResult['status'] = hasCancelled
    ? 'cancelled'
    : hasIssue && hasSuccess
      ? 'partial'
      : (hasFailure || hasIssue) && !hasSuccess
        ? 'failed'
        : !hasResults
          ? 'empty'
          : 'complete';
  run.finished = true;
  run.progress = { ...run.progress, phase: status };
  publish(run);
}

export function failUnfinished(run: ActiveRun): void {
  for (const feature of run.selection.healthKitFeatures) {
    const status = run.progress.features[feature].status;
    if (!isTerminalFeatureStatus(status))
      setFeature(run, feature, { status: 'failed' });
  }
  if (
    run.selection.eventKit &&
    !isTerminalEventKitStatus(run.progress.eventKit.status)
  ) {
    setEventKit(run, { status: 'failed', candidates: [] });
  }
  finish(run);
}

function isTerminalEventKitStatus(status: string): boolean {
  return (
    ['notSelected', 'complete', 'empty', 'failed', 'cancelled'].includes(
      status,
    ) || ['writeOnly', 'notDetermined', 'denied', 'restricted'].includes(status)
  );
}

function isTerminalFeatureStatus(status: UnifiedFeatureStatus): boolean {
  return [
    'notSelected',
    'complete',
    'empty',
    'partial',
    'unsupportedFeature',
    'unsupportedPlatform',
    'unavailable',
    'unsupportedData',
    'notRun',
    'failed',
    'cancelled',
  ].includes(status);
}

function isSuccessStatus(status: UnifiedFeatureStatus): boolean {
  return status === 'complete' || status === 'empty';
}

function isIssueStatus(status: UnifiedFeatureStatus): boolean {
  return [
    'partial',
    'unsupportedFeature',
    'unsupportedPlatform',
    'unavailable',
    'unsupportedData',
    'notRun',
    'failed',
    'cancelled',
  ].includes(status);
}
