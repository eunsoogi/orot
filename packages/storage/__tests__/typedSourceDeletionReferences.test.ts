import { openEncryptedStorage } from '../src/open';
import { listTypedSourceDeletionReferences } from '../src/sourceDeletionReferences';
import { createDatabase, options, audioSourceRecord } from './sourceEvidenceTestSupport';

test('collects the source and only records linked to that source, preserving their kinds', async () => {
  const database = createDatabase();
  try {
    const repository = await openEncryptedStorage(options(database));
    const source = await repository.sourceRecords.create(audioSourceRecord('shared-id'));
    const base = {
      effectiveAt: '2026-01-01T00:00:00Z',
      recordedAt: '2026-01-01T00:00:00Z',
      ingestedAt: '2026-01-01T00:00:00Z',
      reviewState: { status: 'unreviewed' as const },
      encounterKind: 'outpatient' as const,
      summary: 'Synthetic',
    };
    await repository.put('encounter', {
      ...base,
      id: 'shared-id',
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
    });
    await repository.put('encounter', {
      ...base,
      id: 'linked',
      provenance: { origin: 'derived', sourceRecordIds: [source.id] },
    });
    expect(await listTypedSourceDeletionReferences(database, source.id)).toEqual(
      expect.arrayContaining([
        { kind: 'source_record', id: 'shared-id' },
        { kind: 'encounter', id: 'linked' },
      ]),
    );
    expect(await listTypedSourceDeletionReferences(database, source.id)).not.toContainEqual({
      kind: 'encounter',
      id: 'shared-id',
    });
  } finally {
    await database.closeAsync?.();
  }
});
