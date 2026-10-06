export const LOCAL_QUERY_MAX_ROWS = 100;
export const LOCAL_QUERY_MAX_RANGE_MS = 366 * 24 * 60 * 60 * 1000;
export const LOCAL_MEMORY_MAX_RESULTS = 5;

export const LOCAL_OBSERVATION_QUERY_TYPES = [
  'blood_pressure',
  'sleep',
  'heart_rate',
  'steps',
  'body_mass',
] as const;
export type LocalObservationQueryType = (typeof LOCAL_OBSERVATION_QUERY_TYPES)[number];

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

export interface LocalMedicationQueryResult<T> extends LocalQueryResult<T> {
  readonly timeBasis: 'local_ingest';
}

export interface LocalAppointmentQueryResult<T> {
  readonly status: 'available' | 'no_confirmed_upcoming_calendar_appointment';
  readonly appointment: T | null;
}

export interface LocalTranscriptQueryResult<T> extends LocalQueryResult<T> {
  readonly staleArtifacts: readonly LocalStaleTranscriptArtifact[];
  readonly staleArtifactsHaveMore: boolean;
}

export interface LocalStaleTranscriptArtifact {
  readonly kind: string;
  readonly id: string;
  readonly supersededSegmentId: string;
  readonly currentSegmentId: string;
  readonly invalidatedAt: string;
}

export interface LocalRecordQueryStorage<Health, Medication, Dose, Appointment, Transcript> {
  queryHealthObservations(
    filter: LocalQueryWindow & { readonly type: LocalObservationQueryType },
  ): Promise<LocalQueryResult<Health>>;
  queryImportedMedicationDefinitions(
    filter: LocalQueryWindow,
  ): Promise<LocalMedicationQueryResult<Medication>>;
  queryImportedDoseEvents(filter: LocalQueryWindow): Promise<LocalQueryResult<Dose>>;
  queryNextConfirmedCalendarAppointment(
    afterInclusive: string,
  ): Promise<LocalAppointmentQueryResult<Appointment>>;
  queryTranscriptEvidence(
    filter: LocalQueryWindow & { readonly recordingSourceId: string },
  ): Promise<LocalTranscriptQueryResult<Transcript>>;
}

export interface LocalMemoryHit {
  readonly id: string;
  readonly text: string;
  readonly score: number;
  readonly kind: string;
  readonly provenance: {
    readonly sourceIds: readonly string[];
    readonly sourceDates?: readonly { readonly sourceId: string; readonly date: string }[];
    readonly reviewState: string;
  };
  readonly createdAt: number;
}

export interface LocalMemoryReader {
  recall(query: string, options?: { readonly limit?: number }): Promise<readonly LocalMemoryHit[]>;
}

export interface LocalMemoryQueryResult {
  readonly status: 'available' | 'no_matching_current_memory' | 'local_memory_unavailable';
  readonly hits: readonly LocalMemoryHit[];
  readonly limit: number;
}

export interface LocalRecordQueryService<Health, Medication, Dose, Appointment, Transcript> {
  queryHealthObservations(
    filter: LocalQueryWindow & { readonly type: LocalObservationQueryType },
  ): Promise<LocalQueryResult<Health>>;
  queryImportedMedicationDefinitions(
    filter: LocalQueryWindow,
  ): Promise<LocalMedicationQueryResult<Medication>>;
  queryImportedDoseEvents(filter: LocalQueryWindow): Promise<LocalQueryResult<Dose>>;
  queryNextConfirmedCalendarAppointment(
    afterInclusive: string,
  ): Promise<LocalAppointmentQueryResult<Appointment>>;
  queryTranscriptEvidence(
    filter: LocalQueryWindow & { readonly recordingSourceId: string },
  ): Promise<LocalTranscriptQueryResult<Transcript>>;
  searchMemory(query: string, limit?: number): Promise<LocalMemoryQueryResult>;
}

/** Composes typed local storage reads with the memory service's source invalidation rules. */
export function createLocalRecordQueryService<Health, Medication, Dose, Appointment, Transcript>(
  storage: LocalRecordQueryStorage<Health, Medication, Dose, Appointment, Transcript>,
  memory?: LocalMemoryReader,
): LocalRecordQueryService<Health, Medication, Dose, Appointment, Transcript> {
  return {
    queryHealthObservations: (filter) => storage.queryHealthObservations(filter),
    queryImportedMedicationDefinitions: (filter) =>
      storage.queryImportedMedicationDefinitions(filter),
    queryImportedDoseEvents: (filter) => storage.queryImportedDoseEvents(filter),
    queryNextConfirmedCalendarAppointment: (afterInclusive) =>
      storage.queryNextConfirmedCalendarAppointment(afterInclusive),
    queryTranscriptEvidence: (filter) => storage.queryTranscriptEvidence(filter),
    async searchMemory(query, limit = 3) {
      const normalizedQuery = query.trim();
      if (!normalizedQuery || normalizedQuery.length > 1000) {
        throw new Error('A memory query must contain between 1 and 1000 characters.');
      }
      if (!Number.isInteger(limit) || limit < 1 || limit > LOCAL_MEMORY_MAX_RESULTS) {
        throw new Error(`A memory query limit must be between 1 and ${LOCAL_MEMORY_MAX_RESULTS}.`);
      }
      if (!memory) return { status: 'local_memory_unavailable', hits: [], limit };
      const hits = await memory.recall(normalizedQuery, { limit });
      return {
        status: hits.length > 0 ? 'available' : 'no_matching_current_memory',
        hits,
        limit,
      };
    },
  };
}
