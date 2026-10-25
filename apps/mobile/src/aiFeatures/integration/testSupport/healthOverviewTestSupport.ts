import { chunkStructuredRecord, type StructuredRecordKind } from '@orot/rag';
import { createLocalEvidenceSnapshot } from '../evidenceSnapshot';
import { createLocalEvidenceSearchTool } from '../evidenceSearchTool';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import {
  healthObservation,
  entry,
  inventory,
  repository,
  noStaleEvidence,
} from './personalEvidenceTestSupport';
import type { RecordMap } from '@orot/storage';

/** Synthetic typed rows exercise all six overview topics without provider execution. */
export async function healthOverviewTestFixture() {
  const base = (id: string) => {
    const row = healthObservation(id, [])
      .record as RecordMap['health_observation'];
    return {
      id: row.id,
      effectiveAt: row.effectiveAt,
      ingestedAt: row.ingestedAt,
      recordedAt: row.recordedAt,
      provenance: row.provenance,
      reviewState: row.reviewState,
    };
  };
  const meds = [0, 1, 2, 3].map(index =>
    entry('medication_definition', {
      ...base(`private-med-${index}`),
      medicationConceptIdentifier: `concept-${index}`,
      displayText: `예시약${index}`,
      generalForm: 'tablet',
      hasSchedule: true,
      isArchived: false,
    }),
  );
  const samples = [
    ['blood pressure systolic', 123, 'mmHg'],
    ['blood pressure diastolic', 78, 'mmHg'],
    ['heart_rate', 76, 'count/min'],
    ['body_mass', 68, 'kg'],
    ['step_count', 1234, 'count'],
  ] as const;
  const measurements = samples.map(([concept, amount, unit], index) =>
    entry('health_observation', {
      ...healthObservation(`private-health-${index}`, [], amount).record,
      concept,
      value: {
        kind: 'quantity',
        amount,
        unit,
        sourceRepresentation: {
          status: 'unavailable',
          reason: 'display_not_provided',
        },
      },
    }),
  );
  const sleep = entry('health_observation', {
    ...healthObservation('private-sleep', []).record,
    concept: 'HKCategoryTypeIdentifierSleepAnalysis',
    value: { kind: 'text', text: '4' },
    endedAt: '2026-01-02T08:05:00Z',
    provenance: {
      origin: 'imported',
      sourceRecordIds: [],
      source: { system: 'healthkit' },
    },
  });
  const symptom = entry('symptom_entry', {
    ...base('private-symptom'),
    description: '기록된 예시 증상',
  });
  const dose = entry('dose_event', {
    ...base('private-dose'),
    medicationAssertionId: 'synthetic-assertion',
    eventKind: 'taken',
    dose: { amount: 1, unit: 'tablet' },
  });
  const records = [...meds, ...measurements, sleep, symptom, dose];
  const chunks = records.map(row =>
    chunkStructuredRecord(
      row.kind as StructuredRecordKind,
      row.record as never,
    ),
  );
  const registry = new LocalEvidenceReferenceRegistry();
  const source = repository(records);
  const snapshot = await createLocalEvidenceSnapshot({
    inventory: inventory(records),
    records,
    persistedChunks: chunks,
    loadCurrentPersistedChunks: async () => chunks,
    ...noStaleEvidence,
    repository: source,
    registry,
    memoryRecords: [],
    memoryStorage: { listRecords: async () => [] },
  });
  const search = jest.fn(async () =>
    snapshot.chunks.map(chunk => ({
      chunk,
      score: 1,
      lexicalRank: 1,
      vectorRank: null,
    })),
  );
  const loadSnapshot = jest.fn(async () => snapshot);
  const tool = createLocalEvidenceSearchTool({
    id: 'local',
    sourceKind: 'personal_record',
    rag: { search },
    registry,
    allowHealthOverview: true,
    maxResults: 6,
    loadSnapshot,
  });
  return {
    records,
    chunks,
    meds,
    registry,
    source,
    snapshot,
    search,
    loadSnapshot,
    tool,
  };
}
