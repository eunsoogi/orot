import { createRecordRepository, runMigrations } from '@orot/storage';
import { openOpSqliteFileQueue } from '../../../test-support/opSqliteFileQueueFixture';
import {
  acquireIndependentReadEpoch,
  acquireWorkoutReadEpoch,
  awaitIndependentReadSettlementResult,
  guardedNativeDatabase,
} from '../protectedReadEpoch';
import {
  bindProtectedLocalRepositories,
  tryAdvanceStepAnchor,
} from '../workoutStepAnchorContract';

function gate() {
  let release!: () => void;
  const wait = new Promise<void>(resolve => {
    release = resolve;
  });
  return { wait, release };
}

test.each(['queued-before-begin', 'arrived-during-proof'] as const)(
  'unconfirmed native rollback retains the foreign direct-write fence (%s)',
  async timing => {
    const f = openOpSqliteFileQueue();
    const schemaSubmitted = gate();
    const schemaHeld = gate();
    const directHeld = gate();
    const schemaEntered = gate();
    let blockHandoff = false;
    const owner = guardedNativeDatabase({
      ...f.database,
      transaction(callback: Parameters<typeof f.database.transaction>[0]) {
        return f.database.transaction(tx =>
          callback({
            ...tx,
            async execute(query, bindings) {
              const result = await tx.execute(query, bindings);
              if (
                blockHandoff &&
                query.startsWith('SELECT sql FROM main.sqlite_schema')
              ) {
                schemaEntered.release();
                await schemaHeld.wait;
                throw new Error('schema proof could not complete');
              }
              return result;
            },
          }),
        );
      },
    });
    const sql = 'UPDATE synthetic_source SET revision = 1';
    const seen: string[] = [];
    let foreign: Promise<unknown> | undefined;
    let scoped: Promise<unknown> | undefined;
    try {
      await runMigrations(owner);
      await owner.execute('CREATE TABLE synthetic_source (revision INTEGER)');
      await owner.execute('INSERT INTO synthetic_source VALUES (0)');
      const records = bindProtectedLocalRepositories(
        createRecordRepository(owner),
        owner,
        () => true,
      );
      f.observeSubmit(query => {
        seen.push(query);
        if (query.startsWith('SELECT sql FROM main.sqlite_schema'))
          schemaSubmitted.release();
      });
      f.observeControl(query => {
        if (query === 'ROLLBACK;')
          throw new Error('unconfirmed native rollback');
      });
      f.delayWorker(async query => {
        if (query === sql && timing === 'queued-before-begin')
          await directHeld.wait;
      });
      blockHandoff = true;
      if (timing === 'queued-before-begin') foreign = owner.execute(sql);
      const advance = tryAdvanceStepAnchor(
        records,
        null,
        'private-synthetic-cursor',
        () => '2035-01-01T00:00:00.000Z',
      )!;
      // Set the rejection handler before any gate is released.
      scoped = advance().catch((error: unknown) => error);
      await schemaSubmitted.wait; // synchronous BEGIN has occurred; proof is already enqueued.
      if (timing === 'queued-before-begin') {
        directHeld.release();
        await foreign;
      } else {
        // The direct query joins the same transaction independently of its callback.
        await schemaEntered.wait;
        foreign = owner.execute(sql);
        await foreign; // Native UPDATE settled before we release the proof callback.
      }
      await schemaEntered.wait;
      expect(
        (await owner.execute('SELECT revision FROM synthetic_source')).rows[0]
          ?.revision,
      ).toBe(1);
      expect(acquireWorkoutReadEpoch(owner)).toBeUndefined();
      expect(acquireIndependentReadEpoch(owner)).toBeUndefined();
      const settlement = awaitIndependentReadSettlementResult(owner, 1000);
      schemaHeld.release();
      await Promise.allSettled([foreign]);
      expect(await scoped).toEqual(
        expect.objectContaining({
          message: expect.stringContaining('unconfirmed native rollback'),
        }),
      );
      await expect(settlement).resolves.toBe('settlement_failed');
      expect(f.events.some(event => event.event === 'ROLLBACK;')).toBe(true);
      expect(
        (await owner.execute('SELECT revision FROM synthetic_source')).rows[0]
          ?.revision,
      ).toBe(0);
      expect(
        seen.some(query =>
          query.startsWith('INSERT INTO main.healthkit_sync_checkpoints'),
        ),
      ).toBe(false);
      expect(acquireWorkoutReadEpoch(owner)).toBeUndefined();
      expect(acquireIndependentReadEpoch(owner)).toBeUndefined();
    } finally {
      directHeld.release();
      schemaHeld.release();
      await Promise.allSettled([foreign, scoped]);
      await f.close();
    }
  },
);
