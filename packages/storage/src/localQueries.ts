import type { Appointment, DoseEvent, HealthObservation, MedicationDefinition } from '@orot/domain';
import { decodeStoredRecord } from './recordPersistence';
import {
  decodeLocalQueryRows,
  LOCAL_OBSERVATION_QUERY_TYPES,
  parseLocalQueryTimestamp,
  parseLocalQueryWindow,
} from './localQueryContracts';
import type {
  LocalMedicationDefinitionQueryResult,
  LocalObservationQueryType,
  LocalRecordQueryRepository,
  NextCalendarAppointmentResult,
} from './localQueryContracts';
import { queryTranscriptEvidence } from './localTranscriptQueries';
import type { SqlDatabase } from './sql';

const conceptsByType: Record<LocalObservationQueryType, readonly string[]> = {
  blood_pressure: ['blood pressure systolic', 'blood pressure diastolic'],
  sleep: ['HKCategoryTypeIdentifierSleepAnalysis'],
  heart_rate: ['heart_rate'],
  steps: ['step_count'],
  body_mass: ['body_mass'],
};

/** Exposes fixed, typed SQL reads without making unbounded repository lists model-callable. */
export function createLocalRecordQueryRepository(
  database: SqlDatabase,
): LocalRecordQueryRepository {
  return {
    async queryHealthObservations(filter) {
      const window = parseLocalQueryWindow(filter);
      if (!(LOCAL_OBSERVATION_QUERY_TYPES as readonly string[]).includes(filter.type)) {
        throw new Error('The health observation query type is not supported.');
      }
      const concepts = conceptsByType[filter.type];
      const placeholders = concepts.map(() => '?').join(', ');
      const result = await database.execute(
        `SELECT payload_json FROM health_observations
         WHERE json_extract(payload_json, '$.provenance.origin') = 'imported'
           AND json_extract(payload_json, '$.provenance.source.system') = 'healthkit'
           AND json_extract(payload_json, '$.concept') IN (${placeholders})
           AND ((json_extract(payload_json, '$.endedAt') IS NOT NULL
                 AND julianday(effective_at) < julianday(?)
                 AND julianday(json_extract(payload_json, '$.endedAt')) > julianday(?))
             OR (julianday(effective_at) >= julianday(?)
                 AND julianday(effective_at) < julianday(?)))
         ORDER BY julianday(effective_at) ASC, id ASC LIMIT ?`,
        [...concepts, window.to, window.from, window.from, window.to, window.limit + 1],
      );
      return decodeLocalQueryRows<HealthObservation>(
        result.rows,
        window.limit,
        'health_observation',
      );
    },

    async queryImportedMedicationDefinitions(filter) {
      const window = parseLocalQueryWindow(filter);
      const result = await database.execute(
        `SELECT payload_json FROM medication_definitions
         WHERE json_extract(payload_json, '$.provenance.origin') = 'imported'
           AND json_extract(payload_json, '$.provenance.source.system') = 'healthkit'
           AND julianday(ingested_at) >= julianday(?)
           AND julianday(ingested_at) < julianday(?)
         ORDER BY julianday(ingested_at) ASC, id ASC LIMIT ?`,
        [window.from, window.to, window.limit + 1],
      );
      return {
        ...decodeLocalQueryRows<MedicationDefinition>(
          result.rows,
          window.limit,
          'medication_definition',
        ),
        timeBasis: 'local_ingest',
      } satisfies LocalMedicationDefinitionQueryResult;
    },

    async queryImportedDoseEvents(filter) {
      const window = parseLocalQueryWindow(filter);
      const result = await database.execute(
        `SELECT payload_json FROM dose_events
         WHERE json_extract(payload_json, '$.eventKind') = 'observed'
           AND json_extract(payload_json, '$.provenance.origin') = 'imported'
           AND json_extract(payload_json, '$.provenance.source.system') = 'healthkit'
           AND ((json_extract(payload_json, '$.endedAt') IS NOT NULL
                 AND julianday(effective_at) < julianday(?)
                 AND julianday(json_extract(payload_json, '$.endedAt')) > julianday(?))
             OR (julianday(effective_at) >= julianday(?)
                 AND julianday(effective_at) < julianday(?)))
         ORDER BY julianday(effective_at) ASC, id ASC LIMIT ?`,
        [window.to, window.from, window.from, window.to, window.limit + 1],
      );
      const resultSet = decodeLocalQueryRows<Extract<DoseEvent, { eventKind: 'observed' }>>(
        result.rows,
        window.limit,
        'dose_event',
      );
      if (resultSet.records.some((record) => record.eventKind !== 'observed')) {
        throw new Error('A stored imported dose event has an invalid event kind.');
      }
      return resultSet;
    },

    async queryNextConfirmedCalendarAppointment(afterInclusive) {
      const after = parseLocalQueryTimestamp(afterInclusive);
      const result = await database.execute(
        `SELECT payload_json FROM appointments
         WHERE json_extract(payload_json, '$.status') IN ('scheduled', 'rescheduled')
           AND json_extract(payload_json, '$.provenance.origin') = 'user_reported'
           AND json_extract(payload_json, '$.calendarEventIdentifier') IS NOT NULL
           AND json_extract(payload_json, '$.calendarEventSnapshot') IS NOT NULL
           AND julianday(effective_at) >= julianday(?)
         ORDER BY julianday(effective_at) ASC, id ASC LIMIT 1`,
        [after],
      );
      const row = result.rows[0];
      const appointment: Appointment | null = row
        ? decodeStoredRecord('appointment', row.payload_json)
        : null;
      const response: NextCalendarAppointmentResult = {
        status: appointment ? 'available' : 'no_confirmed_upcoming_calendar_appointment',
        appointment,
      };
      return response;
    },

    queryTranscriptEvidence: (filter) => queryTranscriptEvidence(database, filter),
  };
}

export type { LocalQueryWindow, LocalQueryResult } from './localQueryContracts';
