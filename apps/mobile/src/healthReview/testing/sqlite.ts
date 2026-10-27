import {
  createRecordRepository,
  createLangGraphCheckpointStorage,
  runMigrations,
} from '@orot/storage';
import { SqliteCheckpointSaver } from '@orot/agent-runtime';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createLocalEvidenceData } from '../../healthEvidence/localEvidenceData';
import { createLocalHealthEvidenceRepository } from '../../healthEvidence/localEvidenceRepository';
import { createHealthReviewRequests } from '../requests';

export const instant = '2026-10-27T12:00:00.000Z';
export const safety = {
  requestType: 'health_review',
  population: 'adult_not_pregnant',
  readingContext: 'current_measurement',
  readings: [
    {
      systolicMmHg: 120,
      diastolicMmHg: 80,
      unit: 'mmHg',
      measuredAt: instant,
      source: 'user-entered cuff reading',
    },
  ],
  symptomAssessment: { status: 'no_new_or_concerning_symptoms' },
} as const;

/** Imported observations have their own identities and no request-owned source relation. */
export async function healthReviewSqlite(path = ':memory:') {
  const connection = openSqliteTestDatabase(path);
  await runMigrations(connection.database);
  const repository = createRecordRepository(connection.database);
  const saver = (sourceId?: string) =>
    new SqliteCheckpointSaver(
      createLangGraphCheckpointStorage(connection.database, {
        sourceRecordId: sourceId,
      }),
    );
  let next = 0;
  const requests = createHealthReviewRequests(repository, saver(), {
    createId: () => 'request/' + ++next,
    now: () => instant,
  });
  const data = {
    ...createLocalEvidenceData(connection.database),
    repository: createLocalHealthEvidenceRepository(connection.database),
    rag: {
      index: async () => undefined,
      search: async () => {
        throw new Error('Overview must not embed.');
      },
    },
    memoryStorage: { listRecords: async () => [] },
    loadMemoryRecords: async () => [],
  };
  const seed = async () => {
    await repository.put('health_observation', {
      id: 'healthkit-pulse',
      observationKind: 'measurement',
      concept: 'heart_rate',
      value: { kind: 'quantity', amount: 70, unit: 'count/min' },
      effectiveAt: '2026-10-27T11:59:59.999Z',
      ingestedAt: instant,
      reviewState: { status: 'unreviewed' },
      provenance: {
        origin: 'imported',
        sourceRecordIds: [],
        source: {
          system: 'com.apple.healthkit',
          sourceIdentifier: 'pulse-sample',
        },
      },
    });
  };
  return { ...connection, repository, saver, requests, data, seed };
}
