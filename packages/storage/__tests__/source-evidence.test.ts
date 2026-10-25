import { describe, expect, it } from '@jest/globals';
import { openEncryptedStorage } from '../src';
import {
  audioSourceRecord,
  createDatabase,
  evidenceSpan,
  hashA,
  hashB,
  join,
  mkdtempSync,
  options,
  rmSync,
  sourceRecord,
  tmpdir,
} from './sourceEvidenceTestSupport';

describe('persistent source and evidence repositories', () => {
  it('deduplicates by content hash and reloads updated source relationships after reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orot-source-evidence-'));
    const databasePath = join(directory, 'database.sqlite');
    const firstDatabase = createDatabase(databasePath);
    const firstRepository = await openEncryptedStorage(options(firstDatabase));
    const createdSource = await firstRepository.sourceRecords.create(audioSourceRecord('source-1'));
    const duplicate = await firstRepository.sourceRecords.create({
      ...audioSourceRecord('source-duplicate'),
      title: 'Duplicate metadata must not replace the original',
    });
    const createdSpan = await firstRepository.evidenceSpans.create(
      evidenceSpan('span-1', 'source-1', {
        kind: 'audio_time_range',
        startMs: 1200,
        endMs: 2600,
      }),
    );

    expect(duplicate).toEqual(createdSource);
    expect(await firstRepository.sourceRecords.get('source-duplicate')).toBeNull();
    expect(await firstRepository.evidenceSpans.listForSourceRecord('source-1')).toEqual([
      createdSpan,
    ]);

    const updatedSource = { ...createdSource, title: 'Updated source', contentHash: hashB };
    const updatedSpan = {
      ...createdSpan,
      text: 'Updated excerpt.',
      locator: { kind: 'document_range' as const, pageNumber: 2, startOffset: 4, endOffset: 20 },
    };
    await firstRepository.sourceRecords.update(updatedSource);
    await firstRepository.evidenceSpans.update(updatedSpan);
    await firstDatabase.closeAsync?.();

    const reopenedDatabase = createDatabase(databasePath);
    const reopenedRepository = await openEncryptedStorage(options(reopenedDatabase));
    expect(await reopenedRepository.sourceRecords.findByContentHash(hashB)).toEqual(updatedSource);
    expect(await reopenedRepository.evidenceSpans.get('span-1')).toEqual(updatedSpan);
    expect(await reopenedRepository.evidenceSpans.listForSourceRecord('source-1')).toEqual([
      updatedSpan,
    ]);
    expect(await reopenedRepository.sourceRecords.delete('source-1')).toBe(true);
    expect(await reopenedRepository.evidenceSpans.get('span-1')).toBeNull();
    await reopenedDatabase.closeAsync?.();
    rmSync(directory, { recursive: true, force: true });
  });

  it('rejects missing parents, conflicting IDs, and duplicate hashes on update', async () => {
    const database = createDatabase();
    const repository = await openEncryptedStorage(options(database));

    await expect(
      repository.evidenceSpans.create(
        evidenceSpan('orphan-span', 'missing-source', {
          kind: 'text_range',
          startOffset: 0,
          endOffset: 4,
        }),
      ),
    ).rejects.toThrow('Evidence span source record does not exist.');
    await expect(
      repository.put(
        'evidence_span',
        evidenceSpan('generic-orphan-span', 'missing-source', {
          kind: 'text_range',
          startOffset: 0,
          endOffset: 4,
        }),
      ),
    ).rejects.toThrow('Evidence span source record does not exist.');

    const first = await repository.sourceRecords.create(sourceRecord('source-1', hashA));
    const second = await repository.sourceRecords.create(sourceRecord('source-2', hashB));
    const existingSpan = await repository.evidenceSpans.create(
      evidenceSpan('span-1', first.id, { kind: 'text_range', startOffset: 0, endOffset: 4 }),
    );
    const orphanUpdate = {
      ...existingSpan,
      sourceRecordId: 'missing-source',
      provenance: { ...existingSpan.provenance, sourceRecordIds: ['missing-source'] },
    };
    await expect(repository.evidenceSpans.update(orphanUpdate)).rejects.toThrow(
      'Evidence span source record does not exist.',
    );
    expect(await repository.evidenceSpans.get(existingSpan.id)).toEqual(existingSpan);
    await expect(repository.sourceRecords.create(sourceRecord('source-1', hashB))).rejects.toThrow(
      'Source record ID already exists with different content.',
    );
    await expect(
      repository.sourceRecords.update({ ...first, contentHash: second.contentHash }),
    ).rejects.toThrow('A source record with this content hash already exists.');
    expect(await repository.sourceRecords.findByContentHash(hashA)).toEqual(first);
    expect(await repository.sourceRecords.findByContentHash(hashB)).toEqual(second);
    await database.closeAsync?.();
  });

  it('deletes provenance-linked records and citations with their source', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orot-source-delete-'));
    const databasePath = join(directory, 'database.sqlite');
    const database = createDatabase(databasePath);
    const repository = await openEncryptedStorage(options(database));
    const source = await repository.sourceRecords.create(sourceRecord('deleted-source', hashA));
    const span = await repository.evidenceSpans.create(
      evidenceSpan('deleted-span', source.id, {
        kind: 'text_range',
        startOffset: 0,
        endOffset: 4,
      }),
    );
    const metadata = {
      effectiveAt: '2026-01-01T00:00:00Z',
      recordedAt: '2026-01-01T00:00:00Z',
      ingestedAt: '2026-01-01T00:00:00Z',
      provenance: { origin: 'derived' as const, sourceRecordIds: [source.id] },
      reviewState: { status: 'unreviewed' as const },
    };
    await repository.put('encounter', {
      ...metadata,
      id: 'deleted-encounter',
      encounterKind: 'outpatient',
      summary: 'Synthetic dependent encounter.',
    });
    await repository.put('visit_question', {
      ...metadata,
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
      id: 'deleted-question',
      questionText: 'Synthetic dependent question?',
      priority: 'routine',
      evidenceSpanIds: [span.id],
    });
    await repository.put('visit_brief', {
      ...metadata,
      id: 'deleted-brief',
      encounterId: 'deleted-encounter',
      summary: 'Synthetic dependent brief.',
      questionIds: ['deleted-question'],
      evidenceSpanIds: [span.id],
      medicationAssertionIds: [],
    });

    expect(await repository.sourceRecords.delete(source.id)).toBe(true);
    expect(await repository.evidenceSpans.get(span.id)).toBeNull();
    expect(await repository.get('encounter', 'deleted-encounter')).toBeNull();
    expect(await repository.get('visit_question', 'deleted-question')).toBeNull();
    expect(await repository.get('visit_brief', 'deleted-brief')).toBeNull();
    await database.closeAsync?.();
    rmSync(directory, { recursive: true, force: true });
  });

  it('keeps source ID deletion fences after reopening storage', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orot-source-tombstone-'));
    const databasePath = join(directory, 'database.sqlite');
    const database = createDatabase(databasePath);
    const repository = await openEncryptedStorage(options(database));
    const source = await repository.sourceRecords.create(sourceRecord('deleted-source', hashA));
    expect(await repository.sourceRecords.delete(source.id)).toBe(true);
    await database.closeAsync?.();

    const reopenedDatabase = createDatabase(databasePath);
    const reopenedRepository = await openEncryptedStorage(options(reopenedDatabase));
    await expect(
      reopenedRepository.sourceRecords.create(sourceRecord(source.id, hashB)),
    ).rejects.toThrow('A deleted source cannot be reimported.');
    await expect(
      reopenedRepository.sourceRecords.create(sourceRecord('replacement-source', hashA)),
    ).resolves.toMatchObject({ id: 'replacement-source' });
    expect(await reopenedRepository.sourceRecords.get(source.id)).toBeNull();
    expect(await reopenedRepository.sourceRecords.findByContentHash(hashA)).toMatchObject({
      id: 'replacement-source',
    });
    await reopenedDatabase.closeAsync?.();
    rmSync(directory, { recursive: true, force: true });
  });

  it('rolls back source and evidence deletion when dependent cleanup fails', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orot-source-delete-rollback-'));
    const database = createDatabase(join(directory, 'database.sqlite'));
    const repository = await openEncryptedStorage(options(database));
    const source = await repository.sourceRecords.create(sourceRecord('retained-source', hashA));
    const span = await repository.evidenceSpans.create(
      evidenceSpan('retained-span', source.id, {
        kind: 'text_range',
        startOffset: 0,
        endOffset: 4,
      }),
    );

    // A failed downstream cleanup must not leave the source without its evidence rows.
    await expect(
      repository.sourceRecords.delete(source.id, async (transaction) => {
        await transaction.execute('DELETE FROM evidence_spans WHERE id = ?', [span.id]);
        throw new Error('injected vector cleanup failure');
      }),
    ).rejects.toThrow('injected vector cleanup failure');

    expect(await repository.sourceRecords.get(source.id)).not.toBeNull();
    expect(await repository.evidenceSpans.get(span.id)).not.toBeNull();
    await database.closeAsync?.();
    rmSync(directory, { recursive: true, force: true });
  });
});
