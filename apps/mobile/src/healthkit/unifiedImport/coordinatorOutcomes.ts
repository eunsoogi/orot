import { healthKitFeatures } from '../types';
import type {
  HealthKitAuthorizationResult,
  HealthKitBatchAuthorizationResult,
  HealthKitFeature,
} from '../types';
import type {
  UnifiedCalendarStatus,
  UnifiedFeatureStatus,
  UnifiedImportResult,
  UnifiedImportSelection,
} from './types';
import type { ActiveRun } from './coordinatorProgress';
import { publish, setCalendar, setFeature } from './coordinatorProgress';

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
  if (
    selected.size !== selection.healthKitFeatures.length ||
    [...selected].some(feature => !healthKitFeatures.includes(feature)) ||
    (selected.size === 0 && !selection.calendar)
  ) {
    throw new Error('Unified import selection is invalid.');
  }
  return {
    healthKitFeatures: healthKitFeatures.filter(feature =>
      selected.has(feature),
    ),
    calendar: selection.calendar,
  };
}

export function cancelRemaining(run: ActiveRun): void {
  for (const feature of run.selection.healthKitFeatures) {
    const status = run.progress.features[feature].status;
    if (status === 'ready' || status === 'waitingAuthorization') {
      setFeature(run, feature, { status: 'cancelled' });
    }
  }
  if (
    run.selection.calendar &&
    (run.progress.calendar.status === 'waitingAuthorization' ||
      run.progress.calendar.status === 'fullAccess')
  ) {
    setCalendar(run, { status: 'cancelled' });
  }
}

export function requestCancel(run: ActiveRun): void {
  if (run.finished || run.cancelled) return;
  run.cancelled = true;
  run.progress = { ...run.progress, phase: 'cancelling' };
  publish(run);
}

export function finish(run: ActiveRun): void {
  const statuses: (UnifiedFeatureStatus | UnifiedCalendarStatus)[] =
    run.selection.healthKitFeatures.map(
      feature => run.progress.features[feature].status,
    );
  if (run.selection.calendar) statuses.push(run.progress.calendar.status);
  const hasCancelled = statuses.includes('cancelled');
  const hasFailure = statuses.includes('failed');
  const hasIssue = statuses.some(isIssueStatus);
  const hasSuccess = statuses.some(isSuccessStatus);
  const hasChanges =
    run.selection.healthKitFeatures.some(feature => {
      const value = run.progress.features[feature];
      return (value.importedCount ?? 0) + (value.deletedCount ?? 0) > 0;
    }) || (run.progress.calendar.eventCount ?? 0) > 0;
  const status: UnifiedImportResult['status'] = hasCancelled
    ? 'cancelled'
    : hasIssue && hasSuccess
      ? 'partial'
      : hasFailure && !hasSuccess
        ? 'failed'
        : hasIssue
          ? 'partial'
          : !hasChanges
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
    run.selection.calendar &&
    !isTerminalCalendarStatus(run.progress.calendar.status)
  ) {
    setCalendar(run, { status: 'failed' });
  }
  finish(run);
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

function isTerminalCalendarStatus(status: UnifiedCalendarStatus): boolean {
  return [
    'notSelected',
    'complete',
    'empty',
    'writeOnly',
    'denied',
    'restricted',
    'notDetermined',
    'failed',
    'cancelled',
  ].includes(status);
}

function isSuccessStatus(
  status: UnifiedFeatureStatus | UnifiedCalendarStatus,
): boolean {
  return status === 'complete' || status === 'empty';
}

function isIssueStatus(
  status: UnifiedFeatureStatus | UnifiedCalendarStatus,
): boolean {
  return [
    'partial',
    'unsupportedFeature',
    'unsupportedPlatform',
    'unavailable',
    'unsupportedData',
    'notRun',
    'failed',
    'cancelled',
    'writeOnly',
    'denied',
    'restricted',
    'notDetermined',
  ].includes(status);
}
