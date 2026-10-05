/** Validates anchored pages while keeping authorization outcomes explicitly unobservable. */
import type {
  HealthKitSampleChangesQuery,
  HealthKitSampleChangesResult,
  HealthKitSampleSnapshot,
} from './types';
import {
  codedError,
  isUnavailable,
  validateFeatureSampleKind,
  validateLimit,
} from './validation';

const MAX_CURSOR_LENGTH = 1_000_000;

export function validateSampleChangesQuery(
  query: HealthKitSampleChangesQuery,
): void {
  if (!isRecord(query)) {
    throw codedError(
      'INVALID_REQUEST',
      'A HealthKit sample changes query is required.',
    );
  }
  validateFeatureSampleKind(query.feature, query.sampleKind);
  validateLimit(query.limit);
  validateCursor(query.cursor);
}

export function requireSampleChangesResult(
  value: unknown,
): HealthKitSampleChangesResult {
  if (!isRecord(value) || value.readAuthorization !== 'notObservable') {
    throw codedError(
      'INVALID_NATIVE_RESPONSE',
      'HealthKit query must not report read authorization.',
    );
  }

  if (
    value.availability === 'available' &&
    value.status === 'completed' &&
    Array.isArray(value.addedSamples) &&
    value.addedSamples.every(isSampleSnapshot) &&
    Array.isArray(value.deletedSampleIds) &&
    value.deletedSampleIds.every(isNonEmptyString) &&
    typeof value.hasMore === 'boolean'
  ) {
    const cursor = validateCursor(value.cursor);
    const addedSamples = value.addedSamples;
    const deletedSampleIds = value.deletedSampleIds;
    if (
      new Set(addedSamples.map(sample => sample.id)).size !==
        addedSamples.length ||
      new Set(deletedSampleIds).size !== deletedSampleIds.length ||
      (cursor === null &&
        (addedSamples.length > 0 || deletedSampleIds.length > 0)) ||
      (value.hasMore && cursor === null)
    ) {
      throw invalidChangePage();
    }
    return {
      availability: 'available',
      status: 'completed',
      readAuthorization: 'notObservable',
      addedSamples,
      deletedSampleIds,
      cursor,
      hasMore: value.hasMore,
    };
  }

  if (isUnavailable(value.availability) && value.status === 'notRun') {
    return {
      availability: value.availability,
      status: 'notRun',
      readAuthorization: 'notObservable',
    };
  }
  throw invalidChangePage();
}

function validateCursor(cursor: unknown): string | null {
  if (
    cursor !== null &&
    (typeof cursor !== 'string' ||
      cursor.length === 0 ||
      cursor.length > MAX_CURSOR_LENGTH)
  ) {
    throw codedError('INVALID_CURSOR', 'HealthKit query cursor is invalid.');
  }
  return cursor as string | null;
}

function isSampleSnapshot(value: unknown): value is HealthKitSampleSnapshot {
  if (!isRecord(value)) return false;
  const hasNoQuantity = value.value === undefined && value.unit === undefined;
  const hasQuantity =
    typeof value.value === 'number' &&
    Number.isFinite(value.value) &&
    isNonEmptyString(value.unit);
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.typeIdentifier) &&
    isTimestamp(value.startDate) &&
    isTimestamp(value.endDate) &&
    typeof value.sourceIdentifier === 'string' &&
    typeof value.sourceName === 'string' &&
    (hasNoQuantity || hasQuantity) &&
    (value.sourceRepresentation === undefined ||
      isUnavailableSourceRepresentation(value.sourceRepresentation)) &&
    (value.categoryValue === undefined ||
      Number.isInteger(value.categoryValue)) &&
    (value.doseQuantity === undefined ||
      (typeof value.doseQuantity === 'number' &&
        Number.isFinite(value.doseQuantity) &&
        value.doseQuantity >= 0)) &&
    (value.doseUnit === undefined || isNonEmptyString(value.doseUnit)) &&
    (value.components === undefined ||
      (Array.isArray(value.components) &&
        value.components.every(isSampleSnapshot)))
  );
}

function isUnavailableSourceRepresentation(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.status === 'unavailable' &&
    value.reason === 'healthkit_does_not_expose_original_display_unit'
  );
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalidChangePage(): Error {
  return codedError(
    'INVALID_NATIVE_RESPONSE',
    'HealthKit sample changes response is invalid.',
  );
}
