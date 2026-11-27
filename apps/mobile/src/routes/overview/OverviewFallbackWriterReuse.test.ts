import { createRecordRepository, runMigrations } from '@orot/storage';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { openOpSqliteFileQueue } from '../../../test-support/opSqliteFileQueueFixture';
import {
  acquireIndependentReadEpoch,
  guardedNativeDatabase,
} from '../../storage/protectedReadEpoch';
import { protectedSqlRead } from '../../storage/guardedMutationBoundary';
import { loadSelectedOverviewSnapshot } from './selectedOverviewSnapshot';

const now = new Date('2026-01-15T12:00:00Z');
const guard = 'health_context_health_observations_update';

test('an already-prepared selected Overview fallback does not revoke the concurrent workout owner', async () => {
  const f = openOpSqliteFileQueue();
  const owner = guardedNativeDatabase(f.database);
  const read = () =>
    loadSelectedOverviewSnapshot(owner, now, new AbortController().signal);
  try {
    await runMigrations(owner);
    const repository = createRecordRepository(owner);
    await repository.put(
      'health_observation',
      healthObservation(
        'synthetic-heart',
        'heart_rate',
        '2026-01-14T12:00:00Z',
      ),
    );
    const initial = await read();
    const writes: string[] = [];
    f.observeSubmit(query => {
      if (!protectedSqlRead(query)) writes.push(query);
    });
    const pendingWorkout = acquireIndependentReadEpoch(owner)!;
    try {
      expect(await read()).toEqual(initial);
      expect(pendingWorkout.current()).toBe(true);
      expect(writes).toEqual([]);
      // An actual same-owner source deletion still retires the proof.
      await owner.execute(
        "DELETE FROM health_observations WHERE id='synthetic-heart'",
      );
      expect(pendingWorkout.current()).toBe(false);
    } finally {
      pendingWorkout.dispose();
    }
    await owner.execute('DROP TRIGGER ' + guard);
    writes.length = 0;
    await read();
    expect(writes.some(sql => sql.includes(guard))).toBe(true);
    await owner.execute('PRAGMA temp_store = FILE');
    writes.length = 0;
    await read();
    expect(writes).toContain('PRAGMA temp_store = MEMORY');
    expect(
      (await owner.execute('SELECT temp_store FROM pragma_temp_store')).rows,
    ).toEqual([{ temp_store: 2 }]);
  } finally {
    await f.close();
  }
});
