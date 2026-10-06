import { compareTimestamps, TimestampSchema } from '@orot/domain';
import type {
  Appointment,
  DoseEvent,
  HealthObservation,
  MedicationDefinition,
  TranscriptEvidenceSegment,
} from '@orot/domain';
import type { SqlValue } from './sql';
import type { StaleTranscriptArtifact } from './transcriptEvidence';
import type { RecordKind } from './contracts';
import { decodeStoredRecord } from './recordPersistence';

export const LOCAL_OBSERVATION_QUERY_TYPES = [
  'blood_pressure',
  'sleep',
  'heart_rate',
  'steps',
  'body_mass',
] as const;
export type LocalObservationQueryType = (typeof LOCAL_OBSERVATION_QUERY_TYPES)[number];

export const MAX_LOCAL_QUERY_ROWS = 100;
export const DEFAULT_LOCAL_QUERY_ROWS = 25;
export const MAX_LOCAL_QUERY_RANGE_MS = 366 * 24 * 60 * 60 * 1000;

export interface LocalQueryWindow {
  readonly fromInclusive: string;
  readonly toExclusive: string;
  readonly limit?: number;
}

export interface LocalQueryResult<T> {
  readonly status: 'available' | 'no_local_records_in_range';
  readonly records: readonly T[];
  readonly hasMore: boolean;
  readonly limit: number;
}

export interface LocalMedicationDefinitionQueryResult extends LocalQueryResult<MedicationDefinition> {
  /** HealthKit medication definitions omit source timestamps; this range uses local ingest time. */
  readonly timeBasis: 'local_ingest';
}

export interface NextCalendarAppointmentResult {
  readonly status: 'available' | 'no_confirmed_upcoming_calendar_appointment';
  readonly appointment: Appointment | null;
}

export interface TranscriptQueryResult extends LocalQueryResult<TranscriptEvidenceSegment> {
  readonly staleArtifacts: readonly StaleTranscriptArtifact[];
  readonly staleArtifactsHaveMore: boolean;
}

export interface LocalRecordQueryRepository {
  queryHealthObservations(
    filter: LocalQueryWindow & { readonly type: LocalObservationQueryType },
  ): Promise<LocalQueryResult<HealthObservation>>;
  queryImportedMedicationDefinitions(
    filter: LocalQueryWindow,
  ): Promise<LocalMedicationDefinitionQueryResult>;
  queryImportedDoseEvents(
    filter: LocalQueryWindow,
  ): Promise<LocalQueryResult<Extract<DoseEvent, { eventKind: 'observed' }>>>;
  queryNextConfirmedCalendarAppointment(
    afterInclusive: string,
  ): Promise<NextCalendarAppointmentResult>;
  queryTranscriptEvidence(
    filter: LocalQueryWindow & { readonly recordingSourceId: string },
  ): Promise<TranscriptQueryResult>;
}

export type { StaleTranscriptArtifact } from './transcriptEvidence';

export interface ParsedLocalQueryWindow {
  readonly from: string;
  readonly to: string;
  readonly limit: number;
}

export function parseLocalQueryWindow(filter: LocalQueryWindow): ParsedLocalQueryWindow {
  const from = TimestampSchema.safeParse(filter.fromInclusive);
  const to = TimestampSchema.safeParse(filter.toExclusive);
  if (!from.success || !to.success) {
    throw new Error('Query bounds must be ISO timestamps with explicit timezone offsets.');
  }
  if (compareTimestamps(from.data, to.data) >= 0) {
    throw new Error('The query end must be after its start.');
  }
  if (Date.parse(to.data) - Date.parse(from.data) > MAX_LOCAL_QUERY_RANGE_MS) {
    throw new Error('A local query range cannot exceed 366 days.');
  }
  const limit = filter.limit ?? DEFAULT_LOCAL_QUERY_ROWS;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LOCAL_QUERY_ROWS) {
    throw new Error(`A local query limit must be between 1 and ${MAX_LOCAL_QUERY_ROWS}.`);
  }
  return { from: from.data, to: to.data, limit };
}

export function parseLocalQueryTimestamp(value: string): string {
  const parsed = TimestampSchema.safeParse(value);
  if (!parsed.success) throw new Error('The appointment query needs a timestamp with timezone.');
  return parsed.data;
}

export function decodeLocalQueryRows<T>(
  rows: readonly Record<string, SqlValue>[],
  limit: number,
  kind: RecordKind,
): LocalQueryResult<T> {
  const hasMore = rows.length > limit;
  const records = rows
    .slice(0, limit)
    .map((row) => decodeStoredRecord(kind, row.payload_json)) as unknown as T[];
  return {
    status: records.length > 0 ? 'available' : 'no_local_records_in_range',
    records,
    hasMore,
    limit,
  };
}
