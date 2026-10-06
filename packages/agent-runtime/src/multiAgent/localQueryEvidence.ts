import type { JsonObject } from '@orot/model-runtime';
import { LOCAL_QUERY_MAX_RANGE_MS, LOCAL_QUERY_MAX_ROWS } from '../localRecordQueryService';
import type {
  LocalQueryResult,
  LocalRecordQueryService,
  LocalObservationQueryType,
  LocalStaleTranscriptArtifact,
} from '../localRecordQueryService';
import type {
  EvidenceBatch,
  EvidenceItem,
  EvidenceSearchRequest,
  EvidenceSearchTool,
} from './contracts';
import { isSourceAllowed } from './evidence';

type ObservationQueryService<TRecord> = Pick<
  LocalRecordQueryService<TRecord, unknown, unknown, unknown, unknown>,
  'queryHealthObservations'
>;
type TranscriptQueryService<TRecord> = Pick<
  LocalRecordQueryService<unknown, unknown, unknown, unknown, TRecord>,
  'queryTranscriptEvidence'
>;
type LocalEvidenceMapper<TRecord> = (record: TRecord) => EvidenceItem;

const EMPTY_INPUT_SCHEMA: JsonObject = {
  type: 'object',
  properties: {},
  additionalProperties: false,
};

function emptyInput(value: unknown): JsonObject | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return Object.keys(value).length === 0 ? {} : undefined;
}

function boundedWindow(request: EvidenceSearchRequest) {
  const range = request.allowedScope.timeRange;
  if (!range) throw new Error('A bounded local query requires an explicit half-open time range.');
  const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/iu;
  const from = Date.parse(range.fromInclusive);
  const to = Date.parse(range.toExclusive);
  if (
    !timestampPattern.test(range.fromInclusive) ||
    !timestampPattern.test(range.toExclusive) ||
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    to <= from
  ) {
    throw new Error('A local query needs ordered ISO instants with explicit timezones.');
  }
  if (to - from > LOCAL_QUERY_MAX_RANGE_MS) {
    throw new Error('A local query range cannot exceed 366 days.');
  }
  if (
    !Number.isInteger(request.resultLimit) ||
    request.resultLimit < 1 ||
    request.resultLimit > LOCAL_QUERY_MAX_ROWS
  ) {
    throw new Error(`A local query limit must be between 1 and ${LOCAL_QUERY_MAX_ROWS}.`);
  }
  // Preserve submillisecond bounds verbatim; the storage API performs its exact 366-day check.
  return {
    fromInclusive: range.fromInclusive,
    toExclusive: range.toExclusive,
    limit: request.resultLimit,
  };
}

function checkedRecords<T>(result: LocalQueryResult<T>, requestedLimit: number): readonly T[] {
  if (
    !Array.isArray(result.records) ||
    result.limit !== requestedLimit ||
    result.records.length > requestedLimit ||
    typeof result.hasMore !== 'boolean' ||
    (result.status === 'no_local_records_in_range' && result.records.length !== 0) ||
    (result.status === 'available' && result.records.length === 0)
  ) {
    throw new Error('The local query returned inconsistent limit or availability metadata.');
  }
  return result.records;
}

function coverageFor(
  request: EvidenceSearchRequest,
  result: LocalQueryResult<unknown>,
  items: readonly EvidenceItem[],
) {
  return {
    sourceKind: 'personal_record' as const,
    searchedSourceIds: [...new Set(items.map((item) => item.sourceId))],
    requestedTimeRange: request.allowedScope.timeRange,
    gaps:
      result.status === 'no_local_records_in_range'
        ? ['No local records matched this bounded query.']
        : [],
    truncated: result.hasMore,
    resultLimit: result.limit,
    returnedCount: items.length,
  };
}

function mapRecords<TRecord>(
  records: readonly TRecord[],
  request: EvidenceSearchRequest,
  mapEvidence: LocalEvidenceMapper<TRecord>,
): EvidenceItem[] {
  const items = records.map(mapEvidence);
  if (
    items.some(
      (item) =>
        item.sourceKind !== 'personal_record' ||
        !isSourceAllowed(request.allowedScope, item.sourceKind, item.sourceId),
    )
  ) {
    throw new Error('The local evidence mapper returned a source outside the selected scope.');
  }
  return items;
}

/**
 * Adapts the typed HealthKit query API without widening the requested range or row limit.
 * The mapper remains with the feature owner because the storage record is its source revision.
 */
export function createLocalObservationEvidenceTool<TRecord>(options: {
  readonly id: string;
  readonly description: string;
  readonly queryType: LocalObservationQueryType;
  readonly service: ObservationQueryService<TRecord>;
  readonly mapEvidence: LocalEvidenceMapper<TRecord>;
}): EvidenceSearchTool {
  return {
    id: options.id,
    sourceKind: 'personal_record',
    execution: 'local_read_only',
    description: options.description,
    inputSchema: EMPTY_INPUT_SCHEMA,
    parseInput: emptyInput,
    async search(request) {
      if (!emptyInput(request.input))
        throw new Error('A health query takes no model-authored filters.');
      if (request.allowedScope.sourceIds !== undefined) {
        throw new Error('The HealthKit query API cannot narrow a read to selected record IDs.');
      }
      const window = boundedWindow(request);
      const result = await options.service.queryHealthObservations({
        ...window,
        type: options.queryType,
      });
      const records = checkedRecords(result, request.resultLimit);
      const items = mapRecords(records, request, options.mapEvidence);
      return {
        items,
        coverage: [coverageFor(request, result, items)],
        conflicts: [],
      } satisfies EvidenceBatch;
    },
  };
}

/** Binds transcript reads to one caller-selected recording source and preserves stale-artifact links. */
export function createLocalTranscriptEvidenceTool<TRecord>(options: {
  readonly id: string;
  readonly description: string;
  readonly recordingSourceId: string;
  readonly service: TranscriptQueryService<TRecord>;
  readonly mapEvidence: LocalEvidenceMapper<TRecord>;
}): EvidenceSearchTool {
  return {
    id: options.id,
    sourceKind: 'personal_record',
    execution: 'local_read_only',
    description: options.description,
    inputSchema: EMPTY_INPUT_SCHEMA,
    parseInput: emptyInput,
    async search(request) {
      if (!emptyInput(request.input))
        throw new Error('A transcript query takes no model-authored filters.');
      if (
        !options.recordingSourceId.trim() ||
        !request.allowedScope.sourceIds?.includes(options.recordingSourceId)
      ) {
        throw new Error('A transcript query requires its selected recording source ID in scope.');
      }
      const window = boundedWindow(request);
      const result = await options.service.queryTranscriptEvidence({
        ...window,
        recordingSourceId: options.recordingSourceId,
      });
      const records = checkedRecords(result, request.resultLimit);
      const items = mapRecords(records, request, options.mapEvidence);
      if (items.some((item) => item.sourceId !== options.recordingSourceId)) {
        throw new Error('A transcript result did not retain its selected recording source ID.');
      }
      const staleConflicts = result.staleArtifacts.map(formatStaleArtifact);
      if (result.staleArtifactsHaveMore)
        staleConflicts.push('Additional transcript artifacts are stale.');
      return {
        items,
        coverage: [
          {
            ...coverageFor(request, result, items),
            truncated: result.hasMore || result.staleArtifactsHaveMore,
          },
        ],
        conflicts: staleConflicts,
      } satisfies EvidenceBatch;
    },
  };
}

function formatStaleArtifact(artifact: LocalStaleTranscriptArtifact): string {
  return `Stale ${artifact.kind} ${artifact.id} references transcript ${artifact.supersededSegmentId}; current segment is ${artifact.currentSegmentId}.`;
}
