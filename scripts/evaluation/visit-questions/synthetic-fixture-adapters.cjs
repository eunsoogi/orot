'use strict';

const { buildPersistedEvidenceChunks } = require('@orot/rag');
const { tokensFor } = require('./synthetic-rag.cjs');

const CHUNKABLE_KINDS = [
  'appointment',
  'encounter',
  'health_observation',
  'medication_assertion',
  'medication_definition',
  'dose_event',
  'symptom_entry',
  'evidence_span',
  'transcript_segment',
];

function createFixtureRepository(records, appointment) {
  const values = new Map([
    ['source_record', records.sourceRecords],
    ['evidence_span', records.evidenceSpans],
    [
      'appointment',
      records.appointments.map((item) => (item.id === appointment.id ? appointment : item)),
    ],
    ['encounter', records.encounters],
    ['health_observation', records.observations],
    ['medication_assertion', records.medicationAssertions],
    ['medication_definition', []],
    ['dose_event', records.doseEvents],
    ['symptom_entry', records.symptoms],
    ['transcript_segment', []],
  ]);
  return {
    async get(kind, id) {
      return (values.get(kind) ?? []).find((record) => record.id === id) ?? null;
    },
    async list(kind) {
      return [...(values.get(kind) ?? [])];
    },
    evidenceSpans: {
      async listForSourceRecord(sourceId) {
        return records.evidenceSpans.filter((span) => span.sourceRecordId === sourceId);
      },
    },
    transcripts: {
      async listForRecording() {
        return [];
      },
      async listStaleArtifacts() {
        return [];
      },
    },
    values,
  };
}

/** Supplies bounded fixture records to the app chunk builder without inventing SQL behavior. */
function createFixtureEvidenceData(repository, trace) {
  const candidates = CHUNKABLE_KINDS.flatMap((kind) =>
    (repository.values.get(kind) ?? []).map((record) => ({ kind, record })),
  );
  const identifiers = new Set(
    [...repository.values.values()].flatMap((records) => records.map((record) => record.id)),
  );
  const catalog = {
    inventoryComplete: true,
    totalRecordCount: candidates.length,
    availableKinds: [...new Set(candidates.map((candidate) => candidate.kind))],
    queriedKinds: [...CHUNKABLE_KINDS],
    unsupportedKinds: [],
    truncatedKinds: [],
  };
  return {
    manualHistory: {},
    async readManualHistoryCandidates() {
      return { candidates: [], hasMoreCandidates: false };
    },
    async readCandidates(query, signal) {
      if (signal?.aborted) throw new Error('Synthetic evidence search was cancelled.');
      const queryTokens = new Set(tokensFor(query));
      const chunks = await buildPersistedEvidenceChunks(repository);
      const chunksByIdentity = new Map(
        chunks.map((chunk) => [
          `${chunk.metadata.recordType}\u0000${chunk.metadata.evidenceId}`,
          chunk,
        ]),
      );
      const matchingCandidates = candidates.filter(({ kind, record }) => {
        const chunk = chunksByIdentity.get(`${kind}\u0000${record.id}`);
        return chunk && tokensFor(chunk.text).some((token) => queryTokens.has(token));
      });
      // Match the app's query-bounded candidate contract before shared hybrid ranking.
      return {
        catalog,
        candidates: matchingCandidates,
        dependencies: [],
        hasMoreCandidates: false,
      };
    },
    async loadCurrentChunks(identities, signal) {
      if (signal?.aborted) throw new Error('Synthetic evidence search was cancelled.');
      trace.chunkLoads += 1;
      const requested = new Set(identities.map(({ kind, id }) => `${kind}\u0000${id}`));
      return (await buildPersistedEvidenceChunks(repository)).filter((chunk) =>
        requested.has(`${chunk.metadata.recordType}\u0000${chunk.metadata.evidenceId}`),
      );
    },
    async loadStaleArtifacts() {
      return [];
    },
    async findIdentifiers(text, signal) {
      if (signal?.aborted) throw new Error('Synthetic evidence search was cancelled.');
      return [...identifiers].filter((identifier) => text.includes(identifier));
    },
  };
}

function createFixtureQueryStorage(appointment, trace) {
  const empty = { status: 'no_local_records_in_range', records: [], hasMore: false, limit: 0 };
  return {
    async queryHealthObservations() {
      return empty;
    },
    async queryImportedMedicationDefinitions() {
      return { ...empty, timeBasis: 'local_ingest' };
    },
    async queryImportedDoseEvents() {
      return empty;
    },
    async queryTranscriptEvidence() {
      return { ...empty, staleArtifacts: [], staleArtifactsHaveMore: false };
    },
    async queryNextConfirmedCalendarAppointment(afterInclusive) {
      trace.appointmentQueries += 1;
      const current = Date.parse(appointment.effectiveAt) >= Date.parse(afterInclusive);
      return {
        status: current ? 'available' : 'no_confirmed_upcoming_calendar_appointment',
        appointment: current ? appointment : null,
      };
    },
  };
}

module.exports = { createFixtureEvidenceData, createFixtureQueryStorage, createFixtureRepository };
