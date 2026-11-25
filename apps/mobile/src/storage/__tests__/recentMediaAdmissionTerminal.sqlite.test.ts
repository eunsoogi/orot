import {
  createRecordRepository,
  runMigrations,
  type SqlDatabase,
} from '@orot/storage';
import { reportRecentMediaAdmission } from '../../providers/recentMediaAdmissionDiagnostic';
import { readCommittedRecentSourcePage } from '../committedRecentSourcePage';
import { guardedNativeDatabase } from '../protectedReadEpoch';
import { openInterleavableRecentSourceDatabase } from '../testSupport/interleavableRecentSourceDatabase';

jest.mock('../../providers/recentMediaAdmissionDiagnostic', () => ({
  reportRecentMediaAdmission: jest.fn(),
}));

const sqlWrite = 'UPDATE synthetic_media_epoch SET revision=revision+1';
const cursor = { id: 'fixture-before', createdAt: '2026-11-25T01:00:00Z' };

test.each(['first missing', 'next missing', 'next revision changed'] as const)(
  'emits exactly one fixed outcome for %s without publishing a retired page',
  async mode => {
    jest.mocked(reportRecentMediaAdmission).mockClear();
    const f = openInterleavableRecentSourceDatabase();
    try {
      await runMigrations(f.database);
      await f.database.execute(
        'CREATE TABLE synthetic_media_epoch(revision INTEGER)',
      );
      await f.database.execute('INSERT INTO synthetic_media_epoch VALUES(0)');
      const repository = createRecordRepository(f.database);
      await repository.put('source_record', {
        id: 'synthetic-private-id',
        sourceKind: 'medical_document',
        ingestedAt: '2026-11-25T00:00:00Z',
        title: 'Synthetic private body',
        provenance: { origin: 'imported', sourceRecordIds: [] },
        reviewState: { status: 'unreviewed' },
      });
      const database =
        mode === 'next revision changed'
          ? guardedNativeDatabase<SqlDatabase>({
              execute: (sql, binds) => f.database.execute(sql, binds),
              async transaction(operation) {
                await f.database.transaction(operation);
                // The catalog fetched a real page, but this native-settlement
                // interleave retires the witness before JavaScript publication.
                await database.execute(sqlWrite);
              },
            })
          : { ...f.database };
      await expect(
        readCommittedRecentSourcePage(
          database,
          mode === 'first missing' ? undefined : cursor,
        ),
      ).rejects.toThrow();
      expect(reportRecentMediaAdmission).toHaveBeenCalledTimes(1);
      expect(reportRecentMediaAdmission).toHaveBeenCalledWith(
        mode === 'first missing' ? 'first_page' : 'next_page',
        mode === 'first missing'
          ? 'owner_missing'
          : mode === 'next missing'
            ? 'missing_witness'
            : 'revision_changed',
      );
    } finally {
      f.close();
    }
  },
);
