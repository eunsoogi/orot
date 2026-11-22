import {
  createRecordRepository,
  listRecentSourcePage,
  runMigrations,
} from '@orot/storage';
import { readCommittedRecentSourcePage } from '../committedRecentSourcePage';
import { openInterleavableRecentSourceDatabase } from '../testSupport/interleavableRecentSourceDatabase';

const fixture = {
  id: 'synthetic-import',
  sourceKind: 'medical_document' as const,
  ingestedAt: '2026-11-22T09:31:00.000Z',
  title: 'Synthetic imported file',
  provenance: { origin: 'imported' as const, sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' as const },
};

test.each(['rollback', 'commit'] as const)(
  'a direct same-handle SELECT can see a held write; the Recent Records reader waits for %s',
  async action => {
    const f = openInterleavableRecentSourceDatabase();
    let entered!: () => void;
    let release!: () => void;
    const inserted = new Promise<void>(done => {
      entered = done;
    });
    const hold = new Promise<void>(done => {
      release = done;
    });
    try {
      await runMigrations(f.database);
      const records = createRecordRepository(f.database);
      const aborted = new Error('Synthetic import rollback.');
      const writer = records
        .transaction(async tx => {
          await tx.put('source_record', fixture);
          entered();
          await hold;
          if (action === 'rollback') throw aborted;
        })
        .catch(error => {
          expect(error).toBe(aborted);
        });
      await inserted;
      // Positive control: the old direct path sees the same uncommitted writer row.
      expect(
        (await listRecentSourcePage(f.database)).map(row => row.id),
      ).toEqual([fixture.id]);
      const published = jest.fn();
      const committed = readCommittedRecentSourcePage(f.database).then(
        published,
      );
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(published).not.toHaveBeenCalled();
      release();
      await writer;
      await committed;
      expect(published).toHaveBeenCalledTimes(1);
      expect(published).toHaveBeenCalledWith(
        action === 'commit'
          ? [
              {
                id: fixture.id,
                kind: fixture.sourceKind,
                createdAt: fixture.ingestedAt,
                title: fixture.title,
              },
            ]
          : [],
      );
    } finally {
      release();
      f.close();
    }
  },
);
