import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';

/** Separate SQLite pagers share an in-memory database without a shared-cache
 * lock or a disk file. The read snapshot blocks the actual writer COMMIT. */
export function answerCommitContentionFixture(options: {
  name: string;
  releaseAfter: number;
  hostException: boolean;
}) {
  const dbPath =
    'file:/orot-answer-one-busy-commit-' + options.name + '?vfs=memdb';
  const fixture = openSqliteTestDatabase(dbPath);
  const { DatabaseSync } = require('node:sqlite') as {
    DatabaseSync: new (path: string) => {
      exec(sql: string): void;
      prepare(sql: string): { all(): unknown[] };
      close(): void;
    };
  };
  const reader = new DatabaseSync(dbPath);
  let lockAtAppend = false;
  let observedBusy = 0;
  let afterReaderRelease: () => void | Promise<void> = () => {};
  let successfulCallbacks = 0;
  const database = {
    ...fixture.database,
    async transaction(
      work: Parameters<typeof fixture.database.transaction>[0],
    ) {
      try {
        await fixture.database.transaction(async tx => {
          await work(tx);
          if (lockAtAppend) successfulCallbacks++;
        });
      } catch (error) {
        const failure = error as { errcode?: number };
        if (lockAtAppend && failure.errcode === 5) {
          observedBusy += 1;
          if (observedBusy >= options.releaseAfter) {
            lockAtAppend = false;
            reader.exec('COMMIT');
            await afterReaderRelease();
          }
          // Use the pinned native driver’s exception envelope, but only after
          // actual independent SQLite pagers decline the commit with code 5.
          throw new Error(
            (options.hostException ? 'Exception in HostFunction: ' : '') +
              '[op-sqlite] SQLite error code: 5, description: database is locked',
          );
        }
        throw error;
      }
    },
  };

  return {
    database,
    holdReader() {
      reader.exec('BEGIN');
      reader.prepare('SELECT id FROM conversation_artifacts').all();
      lockAtAppend = true;
    },
    whenReleased(callback: () => void | Promise<void>) {
      afterReaderRelease = callback;
    },
    busyCount: () => observedBusy,
    callbackCount: () => successfulCallbacks,
    close() {
      reader.close();
      fixture.close();
    },
  };
}
