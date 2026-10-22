import { createRecordRepository, runMigrations } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../../../healthEvidence/localEvidenceTestSupport';
import { createLocalHealthEvidenceRepository } from '../../../healthEvidence/localEvidenceRepository';
import { createLocalEvidenceData } from '../../../healthEvidence/localEvidenceData';
import { loadFeatureEvidenceSnapshot } from '../featureEvidenceSnapshot';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import type { AiFeatureLocalData } from '../localData';

test('an invalidated derived medication assertion cannot provide a current dose name outside the candidate date window', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const repository = createRecordRepository(database);
    const old = '2026-10-01T00:00:00Z';
    const at = '2026-10-20T00:00:00Z';
    const reviewState = { status: 'unreviewed' as const };
    await repository.put('medication_assertion', {
      id: 'derived-medication',
      effectiveAt: old,
      recordedAt: old,
      ingestedAt: old,
      reviewState,
      provenance: {
        origin: 'derived',
        sourceRecordIds: ['synthetic-transcript'],
      },
      assertionKind: 'prescribed',
      medicationName: '합성 전사에서 추출한 약',
    });
    await repository.put('dose_event', {
      id: 'current-dose',
      effectiveAt: at,
      recordedAt: at,
      ingestedAt: at,
      reviewState,
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
      eventKind: 'taken',
      medicationAssertionId: 'derived-medication',
      dose: { amount: 1, unit: '정' },
    });
    await database.execute(
      'INSERT INTO transcript_artifact_staleness (transcript_id, artifact_kind, artifact_id, superseded_segment_id, current_segment_id, invalidated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [
        'synthetic-transcript',
        'medication_assertion',
        'derived-medication',
        'old-segment',
        'new-segment',
        at,
      ],
    );
    const data: AiFeatureLocalData = {
      ...createLocalEvidenceData(database),
      repository: createLocalHealthEvidenceRepository(database),
      memoryStorage: { listRecords: async () => [] },
      loadMemoryRecords: async () => [],
      rag: { index: jest.fn(), search: jest.fn() },
    };
    const registry = new LocalEvidenceReferenceRegistry();
    const signal = new AbortController().signal;
    const snapshot = await loadFeatureEvidenceSnapshot(
      data,
      registry,
      signal,
      '',
      { timeRange: { fromInclusive: at, toExclusive: '2026-10-21T00:00:00Z' } },
    );
    const dose = snapshot.items.find(
      item => registry.resolve(item)?.evidenceId === 'current-dose',
    );
    expect(dose).toBeDefined();
    await expect(registry.revalidateEvidence([dose!], signal)).resolves.toBe(
      false,
    );
    await expect(registry.readSource(dose!, signal)).resolves.toEqual({
      status: 'changed',
    });
  } finally {
    close();
  }
});
