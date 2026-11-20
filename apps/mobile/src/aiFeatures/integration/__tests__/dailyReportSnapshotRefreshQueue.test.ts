import { openOpSqliteFileQueue } from '../../../../test-support/dailyReportOpSqliteQueueFixture';
import {
  prepareReportDatabase,
  reportObservation,
} from '../testSupport/dailyReportFailureStageFixtures';
import { readDailyReportSnapshot } from '../../../healthEvidence/healthContext/dailyReportSnapshot';
import { createDailyReportCalendarWindow } from '../../../healthEvidence/healthContext/dailyReportWindow';
import { createDailyReportSnapshotRefresh } from '../dailyReportSnapshotRefresh';

// Installed JS scheduler + real file SQLite. A separate direct caller writes;
// this is not a tx.execute deletion injected into the transaction callback.
test.each(['during read', 'at commit'] as const)(
  'unstable %s proof is rejected without undoing an external DELETE',
  async boundary => {
    const f = openOpSqliteFileQueue();
    try {
      await prepareReportDatabase(f.database);
      const calendar = createDailyReportCalendarWindow({
        localDate: '2035-01-01',
        timeZone: 'UTC',
        requestedAt: '2035-01-01T12:00:00Z',
      });
      if (calendar.status !== 'ready')
        throw new Error('Invalid synthetic calendar');
      const original = await readDailyReportSnapshot(
        f.database,
        calendar.context,
        {},
      );
      const refresh = createDailyReportSnapshotRefresh(
        f.database,
        original,
        calendar.context,
        {},
      );
      let writes = 0;
      let removed: Promise<unknown> | undefined;
      const remove = () => {
        if (writes++) return;
        f.observeSubmit();
        f.observeCommit();
        removed = f.database.execute(
          'DELETE FROM health_observations WHERE id = ?',
          [reportObservation.id],
        );
      };
      if (boundary === 'at commit') f.observeCommit(remove);
      else
        f.observeSubmit(query => {
          if (query.includes('SELECT mutations, deletions')) remove();
        });
      expect(await refresh.read(new AbortController().signal)).toBeNull();
      await removed;
      expect(writes).toBe(1);
      expect(removed).toBeDefined();
      expect(
        (
          await f.database.execute(
            'SELECT id FROM health_observations WHERE id = ?',
            [reportObservation.id],
          )
        ).rows,
      ).toEqual([]);
      expect(
        f.events.filter(event => event.event.startsWith('ROLLBACK')),
      ).toEqual([]);
    } finally {
      await f.close();
    }
  },
);
