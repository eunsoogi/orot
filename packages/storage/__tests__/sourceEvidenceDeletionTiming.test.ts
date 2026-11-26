import { openEncryptedStorage } from '../src/open';
import type { SourceDeletionTimingPhase } from '../src/sourceEvidenceDeletion';
import type { SqlTimingOutcome } from '../src/ownedSqlTiming';
import { audioSourceRecord, createDatabase, options } from './sourceEvidenceTestSupport';

for (const failVector of [false, true]) {
  test(`recording deletion timing keeps vector and cascade receipts distinct: ${failVector}`, async () => {
    const db = createDatabase();
    const stages: Array<[SourceDeletionTimingPhase, SqlTimingOutcome]> = [];
    try {
      const repository = await openEncryptedStorage(options(db));
      const id = 'synthetic-recording';
      await repository.sourceRecords.create(audioSourceRecord(id));
      await db.execute('CREATE TABLE synthetic_vector_removal (only_row INTEGER)');
      const work = repository.sourceRecords.delete(
        id,
        async (tx) => {
          await tx.execute('INSERT INTO synthetic_vector_removal VALUES (1)');
          if (failVector) throw new Error('vector rollback');
        },
        (phase, outcome) => {
          stages.push([phase, outcome]);
          if (phase === 'references') throw new Error('observers cannot change work');
        },
      );
      if (failVector) await expect(work).rejects.toThrow('vector rollback');
      else await expect(work).resolves.toBe(true);
      const success = (phase: SourceDeletionTimingPhase) => [
        [phase, 'begin'],
        [phase, 'success'],
      ];
      expect(stages).toEqual([
        ...success('admission'),
        ...success('references'),
        ...success('fences'),
        ...(failVector
          ? [
              ['vectors', 'begin'],
              ['vectors', 'failure'],
              ['settlement', 'begin'],
              ['settlement', 'failure'],
            ]
          : [
              ...success('vectors'),
              ...success('cascade'),
              ...success('context'),
              ...success('settlement'),
            ]),
      ]);
      expect(Boolean(await repository.sourceRecords.get(id))).toBe(failVector);
      expect((await db.execute('SELECT * FROM synthetic_vector_removal')).rows).toHaveLength(
        failVector ? 0 : 1,
      );
      expect((await db.execute('SELECT * FROM source_deletion_tombstones')).rows).toHaveLength(
        failVector ? 0 : 1,
      );
    } finally {
      await db.closeAsync?.();
    }
  });
}
