import { tool } from '@langchain/core/tools';
import { localRecordQueryToolSchemas } from './localRecordQueryToolSchemas';
import {
  LOCAL_MEMORY_MAX_RESULTS,
  LOCAL_OBSERVATION_QUERY_TYPES,
  LOCAL_QUERY_MAX_RANGE_MS,
  LOCAL_QUERY_MAX_ROWS,
} from './localRecordQueryService';
import type { LocalObservationQueryType, LocalRecordQueryService } from './localRecordQueryService';

type LocalRangeInput = {
  readonly fromInclusive: string;
  readonly toExclusive: string;
  readonly limit: number;
};

function readObject(input: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('A local query tool requires an object input.');
  }
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) {
    throw new Error('A local query tool received an unsupported filter.');
  }
  return value;
}

function submillisecondDigits(timestamp: string): string {
  return timestamp.match(/\.(\d+)(?=(?:Z|[+-]\d{2}:\d{2})$)/i)?.[1].slice(3) ?? '';
}

function compareQueryTimestamps(left: string, right: string): number {
  const leftMilliseconds = Date.parse(left);
  const rightMilliseconds = Date.parse(right);
  if (leftMilliseconds !== rightMilliseconds) {
    return leftMilliseconds < rightMilliseconds ? -1 : 1;
  }

  // Date.parse keeps milliseconds only; the ISO suffix retains the HealthKit nanoseconds.
  const precision = Math.max(submillisecondDigits(left).length, submillisecondDigits(right).length);
  const normalizedLeft = submillisecondDigits(left).padEnd(precision, '0');
  const normalizedRight = submillisecondDigits(right).padEnd(precision, '0');
  if (normalizedLeft === normalizedRight) return 0;
  return normalizedLeft < normalizedRight ? -1 : 1;
}

function exceedsLocalQueryRange(from: string, to: string): boolean {
  const fromMilliseconds = Date.parse(from);
  const elapsedMilliseconds = Date.parse(to) - fromMilliseconds;
  if (elapsedMilliseconds > LOCAL_QUERY_MAX_RANGE_MS) return true;
  if (elapsedMilliseconds < LOCAL_QUERY_MAX_RANGE_MS) return false;

  // Keep the range cap exact when millisecond timestamps land on its boundary.
  const maximumEnd = new Date(fromMilliseconds + LOCAL_QUERY_MAX_RANGE_MS)
    .toISOString()
    .replace(/Z$/, `${submillisecondDigits(from)}Z`);
  return compareQueryTimestamps(to, maximumEnd) > 0;
}

function readTimestamp(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new Error('Query timestamps must be ISO instants with an explicit timezone.');
  }
  return value;
}

function readLimit(value: unknown): number {
  const limit = value === undefined ? 25 : value;
  if (
    typeof limit !== 'number' ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > LOCAL_QUERY_MAX_ROWS
  ) {
    throw new Error(`A local query limit must be between 1 and ${LOCAL_QUERY_MAX_ROWS}.`);
  }
  return limit;
}

function readRangeInput(
  input: unknown,
  extraKeys: readonly string[] = [],
): LocalRangeInput & Record<string, unknown> {
  const value = readObject(input, ['fromInclusive', 'toExclusive', 'limit', ...extraKeys]);
  const fromInclusive = readTimestamp(value.fromInclusive);
  const toExclusive = readTimestamp(value.toExclusive);
  if (compareQueryTimestamps(toExclusive, fromInclusive) <= 0) {
    throw new Error('The query end must be after its start.');
  }
  if (exceedsLocalQueryRange(fromInclusive, toExclusive)) {
    throw new Error('A local query range cannot exceed 366 days.');
  }
  return {
    fromInclusive,
    toExclusive,
    limit: readLimit(value.limit),
    ...Object.fromEntries(extraKeys.map((key) => [key, value[key]])),
  };
}

function readObservationType(value: unknown): LocalObservationQueryType {
  if (
    typeof value !== 'string' ||
    !(LOCAL_OBSERVATION_QUERY_TYPES as readonly string[]).includes(value)
  ) {
    throw new Error('The health observation query type is not supported.');
  }
  return value as LocalObservationQueryType;
}

/** Exposes only fixed, local read tools; each tool preserves source fields and reports empty input. */
export function createLocalRecordQueryTools(
  service: LocalRecordQueryService<unknown, unknown, unknown, unknown, unknown>,
) {
  const health = tool(
    async (input) => {
      const value = readRangeInput(input, ['type']);
      return JSON.stringify(
        await service.queryHealthObservations({
          fromInclusive: value.fromInclusive,
          toExclusive: value.toExclusive,
          limit: value.limit,
          type: readObservationType(value.type),
        }),
      );
    },
    {
      name: 'query_imported_health_observations',
      description:
        'Read imported HealthKit blood pressure components, sleep categories, heart rate, steps, or body mass within a required half-open time range. Preserve source values, category codes, units, timestamps, and source IDs. No local records do not prove missing HealthKit data or denied permission; do not calculate summaries or metrics.',
      schema: localRecordQueryToolSchemas.health,
    },
  );

  const medications = tool(
    async (input) =>
      JSON.stringify(await service.queryImportedMedicationDefinitions(readRangeInput(input))),
    {
      name: 'query_imported_medication_definitions',
      description:
        'Read imported HealthKit medication catalog entries by app local-ingest time. HealthKit supplies no source creation time for these entries; keep effectiveAt absent and report the returned local_ingest time basis.',
      schema: localRecordQueryToolSchemas.range,
    },
  );

  const doses = tool(
    async (input) => JSON.stringify(await service.queryImportedDoseEvents(readRangeInput(input))),
    {
      name: 'query_imported_dose_events',
      description:
        'Read imported HealthKit dose events in a half-open source event-time range. Preserve HealthKit status codes and wording; an absent event is not evidence of a missed dose.',
      schema: localRecordQueryToolSchemas.range,
    },
  );

  const appointment = tool(
    async (input) => {
      const value = readObject(input, ['afterInclusive']);
      return JSON.stringify(
        await service.queryNextConfirmedCalendarAppointment(readTimestamp(value.afterInclusive)),
      );
    },
    {
      name: 'query_next_confirmed_calendar_appointment',
      description:
        'Read at most the next scheduled or rescheduled Calendar event the user previously confirmed. A missing local match is not evidence that Calendar permission is denied.',
      schema: localRecordQueryToolSchemas.appointment,
    },
  );

  const transcript = tool(
    async (input) => {
      const value = readRangeInput(input, ['recordingSourceId']);
      const recordingSourceId = value.recordingSourceId;
      if (typeof recordingSourceId !== 'string' || recordingSourceId.trim().length === 0) {
        throw new Error('A recording source ID is required.');
      }
      return JSON.stringify(
        await service.queryTranscriptEvidence({
          recordingSourceId,
          fromInclusive: value.fromInclusive,
          toExclusive: value.toExclusive,
          limit: value.limit,
        }),
      );
    },
    {
      name: 'query_transcript_evidence',
      description:
        'Read current transcript revisions only for the selected recording source and bounded time range. Include source-linked revision fields and any stale derived-artifact links in the result.',
      schema: localRecordQueryToolSchemas.transcript,
    },
  );

  const memory = tool(
    async (input) => {
      const value = readObject(input, ['query', 'limit']);
      if (typeof value.query !== 'string') throw new Error('A memory search query is required.');
      const limit = value.limit === undefined ? 3 : value.limit;
      if (
        !Number.isInteger(limit) ||
        typeof limit !== 'number' ||
        limit < 1 ||
        limit > LOCAL_MEMORY_MAX_RESULTS
      ) {
        throw new Error(`A memory query limit must be between 1 and ${LOCAL_MEMORY_MAX_RESULTS}.`);
      }
      return JSON.stringify(await service.searchMemory(value.query, limit));
    },
    {
      name: 'search_source_linked_user_memory',
      description:
        'Search a small number of current user memories. Return source IDs, source dates, and review state with each hit; invalidated-source memories are filtered by the local memory repository.',
      schema: localRecordQueryToolSchemas.memory,
    },
  );

  return [health, medications, doses, appointment, transcript, memory] as const;
}
