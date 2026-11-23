import { transcriptSegment } from './localQueryTestSupport';
import { openEncryptedStorage } from '../src/open';
import { listTypedSourceDeletionReferences } from '../src/sourceDeletionReferences';
import {
  createDatabase,
  options,
  audioSourceRecord,
  evidenceSpan,
} from './sourceEvidenceTestSupport';

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

test('exact membership agrees with the original family projection across multiple pages', async () => {
  const database = createDatabase();
  try {
    const repository = await openEncryptedStorage(options(database));
    const source = await repository.sourceRecords.create(audioSourceRecord('exact-root'));
    const segment = transcriptSegment(source.id);
    await repository.transcripts.append([segment]);
    const span = await repository.evidenceSpans.create(
      evidenceSpan('exact-span', source.id, {
        kind: 'audio_time_range',
        startMs: 10,
        endMs: 100,
      }),
    );
    const at = '2026-01-01T00:00:00Z';
    const ids = [source.id, segment.id, segment.transcriptId, span.id];
    for (let index = 0; index < 50; index += 1) {
      const id = `exact-descendant-${index}`;
      await repository.put('encounter', {
        id,
        effectiveAt: at,
        recordedAt: at,
        ingestedAt: at,
        provenance: {
          origin: 'derived',
          sourceRecordIds: [index % 2 === 0 ? segment.id : segment.transcriptId],
        },
        reviewState: { status: 'unreviewed' },
        encounterKind: 'outpatient',
        summary: 'Synthetic',
      });
      ids.push(id);
    }
    // The source cascade's pre-delete reader remains unmodified.
    expect(await repository.listSourceDeletionReferences(source.id)).toEqual([...ids].sort());
    const check = repository.hasSourceDeletionReferences;
    if (!check) throw new Error('Missing exact membership port');
    const signal = new AbortController().signal;
    expect(await check(source.id, [...ids, source.id], signal)).toBe(true);
    expect(await check(source.id, [...ids, 'nonmember'], signal)).toBe(false);
    expect(await check(source.id, [], signal)).toBe(false);
    expect(await repository.sourceRecords.delete(source.id)).toBe(true);
    expect(await check(source.id, [source.id], signal)).toBe(false);
  } finally {
    await database.closeAsync?.();
  }
});
