import type { SqlDatabase } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import type { ConversationArtifact } from '../conversationArtifactTypes';
import { createSavedGeneratedReportReferences } from '../savedGeneratedReportReferences';

function gate() {
  let release!: () => void;
  const pending = new Promise<void>(resolve => {
    release = resolve;
  });
  return { pending, release };
}

/** A second connection must see the write even while the original callback is held open. */
export async function expectBookmarkSynchronousCommit(
  database: SqlDatabase,
  path: string,
  artifact: ConversationArtifact,
) {
  await database.execute('DELETE FROM saved_generated_report_refs');
  const observer = openSqliteTestDatabase(path);
  const entered = gate();
  const tail = gate();
  let current = true;
  const held: SqlDatabase = {
    execute: (sql, binds) => database.execute(sql, binds),
    transaction: operation =>
      database.transaction(async tx => {
        await operation(tx);
        entered.release();
        await tail.pending;
      }),
  };
  const references = createSavedGeneratedReportReferences(held, async () => {});
  const result = references.bookmarkDailyReport({
    artifactId: artifact.id,
    lease: { id: artifact.sessionId, version: 0 },
    current: () => current,
  });
  try {
    await Promise.race([
      entered.pending,
      result.then(() => {
        throw new Error('Bookmark transaction did not reach its held tail.');
      }),
    ]);
    const row = await observer.database.execute(
      'SELECT artifact_id FROM saved_generated_report_refs',
    );
    expect(row.rows).toEqual([{ artifact_id: artifact.id }]);
    current = false;
  } finally {
    tail.release();
    observer.close();
    expect(await result).toBe(true);
  }
}
