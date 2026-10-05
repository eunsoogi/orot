import type { RecordMap } from '@orot/storage';
import type { MappedCommonObservation } from './types';
import { compareHealthKitTimestamps, isValidHealthKitTimestamp } from './time';

export type StepAggregationResult =
  | {
      readonly status: 'empty';
      readonly total: null;
      readonly sampleIds: readonly [];
      readonly sourceIdentifiers: readonly [];
    }
  | {
      readonly status: 'safe';
      readonly total: number;
      readonly sampleIds: readonly string[];
      readonly sourceIdentifiers: readonly string[];
    }
  | {
      readonly status: 'overlap' | 'conflictingDuplicate' | 'invalid';
      readonly total: null;
      readonly sampleIds: readonly string[];
      readonly sourceIdentifiers: readonly string[];
    };

/** Refuses to sum ambiguous intervals instead of guessing how steps split over time. */
export function evaluateStepAggregation(
  observations: readonly MappedCommonObservation[],
): StepAggregationResult {
  const steps = observations.filter(
    observation => observation.feature === 'steps',
  );
  if (steps.length === 0) {
    return {
      status: 'empty',
      total: null,
      sampleIds: [],
      sourceIdentifiers: [],
    };
  }

  const unique = new Map<string, MappedCommonObservation>();
  for (const sample of steps) {
    if (sample.value.unit !== 'count') return result('invalid', steps);
    const previous = unique.get(sample.recordId);
    if (previous && !sameSample(previous, sample)) {
      return result('conflictingDuplicate', steps);
    }
    unique.set(sample.recordId, sample);
  }

  const ordered = [...unique.values()].sort(
    (left, right) =>
      compareHealthKitTimestamps(left.startDate, right.startDate) ||
      compareHealthKitTimestamps(left.endDate, right.endDate) ||
      left.recordId.localeCompare(right.recordId),
  );
  for (const sample of ordered) {
    if (
      !isValidHealthKitTimestamp(sample.startDate) ||
      !isValidHealthKitTimestamp(sample.endDate) ||
      compareHealthKitTimestamps(sample.startDate, sample.endDate) >= 0 ||
      !Number.isFinite(sample.value.amount) ||
      sample.value.amount < 0
    ) {
      return result('invalid', ordered);
    }
  }

  const overlappingIds = new Set<string>();
  for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
    const left = ordered[leftIndex];
    if (!left) continue;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < ordered.length;
      rightIndex += 1
    ) {
      const right = ordered[rightIndex];
      if (
        !right ||
        compareHealthKitTimestamps(right.startDate, left.endDate) >= 0
      ) {
        break;
      }
      // HealthKit sample ranges are treated as half-open; touching ranges do not overlap.
      if (
        compareHealthKitTimestamps(left.startDate, right.endDate) < 0 &&
        compareHealthKitTimestamps(right.startDate, left.endDate) < 0
      ) {
        overlappingIds.add(left.recordId);
        overlappingIds.add(right.recordId);
      }
    }
  }

  if (overlappingIds.size > 0) {
    const overlappingSampleIds = ordered
      .filter(sample => overlappingIds.has(sample.recordId))
      .map(sample => sample.sourceSampleId);
    return result('overlap', ordered, overlappingSampleIds);
  }

  const total = ordered.reduce((sum, sample) => sum + sample.value.amount, 0);
  if (!Number.isFinite(total)) return result('invalid', ordered);
  return {
    status: 'safe',
    total,
    sampleIds: ordered.map(sample => sample.sourceSampleId),
    sourceIdentifiers: sourceIdentifiers(ordered),
  };
}

/** Evaluates persisted HealthKit step observations so old sources remain in overlap checks. */
export function evaluateStoredStepAggregation(
  observations: readonly RecordMap['health_observation'][],
): StepAggregationResult {
  const steps = observations.filter(
    observation =>
      observation.concept === 'step_count' &&
      observation.provenance.source?.system === 'healthkit',
  );
  if (steps.length === 0) return evaluateStepAggregation([]);

  if (
    steps.some(
      observation =>
        observation.observationKind !== 'measurement' ||
        observation.value.kind !== 'quantity' ||
        observation.value.unit !== 'count',
    )
  ) {
    return {
      status: 'invalid',
      total: null,
      sampleIds: steps.flatMap(record => record.provenance.sourceRecordIds),
      sourceIdentifiers: sourceIdentifiersFromRecords(steps),
    };
  }

  return evaluateStepAggregation(
    steps.map(observation => {
      if (observation.value.kind !== 'quantity') {
        throw new Error(
          'A validated step observation lost its quantity value.',
        );
      }
      return {
        feature: 'steps',
        recordId: observation.id,
        observationKind: 'measurement',
        concept: 'step_count',
        value: observation.value,
        sourceSampleId:
          observation.provenance.sourceRecordIds[0] ?? observation.id,
        typeIdentifier: 'HKQuantityTypeIdentifierStepCount',
        startDate: observation.effectiveAt,
        endDate: observation.endedAt ?? '',
        sourceIdentifier:
          observation.provenance.source?.sourceIdentifier ?? 'unknown-source',
        sourceName:
          observation.provenance.source?.sourceName ?? 'unknown-source',
      };
    }),
  );
}

function result(
  status: 'overlap' | 'conflictingDuplicate' | 'invalid',
  samples: readonly MappedCommonObservation[],
  selectedSampleIds?: readonly string[],
): StepAggregationResult {
  return {
    status,
    total: null,
    sampleIds:
      selectedSampleIds ?? samples.map(sample => sample.sourceSampleId),
    sourceIdentifiers: sourceIdentifiers(samples),
  };
}

function sourceIdentifiers(
  samples: readonly MappedCommonObservation[],
): string[] {
  return [...new Set(samples.map(sample => sample.sourceIdentifier))].sort();
}

function sourceIdentifiersFromRecords(
  records: readonly RecordMap['health_observation'][],
): string[] {
  return [
    ...new Set(
      records.map(
        record =>
          record.provenance.source?.sourceIdentifier ?? 'unknown-source',
      ),
    ),
  ].sort();
}

function sameSample(
  left: MappedCommonObservation,
  right: MappedCommonObservation,
): boolean {
  return (
    left.feature === right.feature &&
    left.observationKind === right.observationKind &&
    left.concept === right.concept &&
    left.typeIdentifier === right.typeIdentifier &&
    left.sourceSampleId === right.sourceSampleId &&
    left.sourceIdentifier === right.sourceIdentifier &&
    left.sourceName === right.sourceName &&
    left.startDate === right.startDate &&
    left.endDate === right.endDate &&
    left.value.amount === right.value.amount &&
    left.value.unit === right.value.unit
  );
}
