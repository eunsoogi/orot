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
