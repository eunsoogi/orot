import { createRecordRepository, runMigrations } from '@orot/storage';
import {
  healthObservation,
  audioSource,
} from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { createHealthEvidenceTestDatabase } from '../../../healthEvidence/localEvidenceTestSupport';
import { createHealthContextReader } from '../../../healthEvidence/healthContext/reader';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { registerHealthContextEvidence } from '../healthContextEvidence';
import { captureSymptomSummarySources } from '../symptomSummarySources';
import { createSymptomSummaryStorage } from '../../../storage/symptomSummaryStorage';
import type { SavedSymptomSummary } from '../../../diseaseHypotheses/savedSummaries';

export const window = {
  fromInclusive: '2026-10-01T00:00:00Z',
  toExclusive: '2026-10-05T00:00:00Z',
  timeZone: 'UTC',
};
export const signal = new AbortController().signal;

export async function healthContextFixture(sourceId?: string) {
  const connection = createHealthEvidenceTestDatabase();
  await runMigrations(connection.database);
  await connection.database.execute('PRAGMA foreign_keys = ON');
  const repository = createRecordRepository(connection.database);
  const read = createHealthContextReader(connection.database);
  if (sourceId) await repository.put('source_record', audioSource(sourceId));
  const observation = healthObservation(
    'inside',
    'heart_rate',
    '2026-10-01T01:00:00Z',
  );
  const inside = sourceId
    ? {
        ...observation,
        provenance: { origin: 'derived' as const, sourceRecordIds: [sourceId] },
      }
    : observation;
  await repository.put('health_observation', inside);
  const registry = new LocalEvidenceReferenceRegistry();
  const report = await read(window, ['measurements']);
  const item = registerHealthContextEvidence({
    registry,
    read,
    report,
    scope: {
      kind: 'health_context_period',
      version: 1,
      topic: 'measurements',
      window,
    },
  });
  const captured = await captureSymptomSummarySources(
    {
      presentation: 'symptom_summary',
      hypotheses: [
        {
          title: '심박 기록',
          summary: '심박수 128 count/min 기록이 있어요.',
          supportingEvidence: [item],
          contraryEvidence: [],
          missingData: [],
          uncertainty: '',
        },
      ],
    },
    registry,
    signal,
  );
  const saved: SavedSymptomSummary = {
    ...captured,
    id: 'period-summary',
    createdAt: '2026-10-05T00:00:00Z',
    modelName: 'Synthetic',
    modelId: 'synthetic',
    providerId: 'synthetic',
  };
  return {
    ...connection,
    repository,
    read,
    registry,
    report,
    inside,
    item,
    saved,
    storage: createSymptomSummaryStorage(connection.database),
  };
}
