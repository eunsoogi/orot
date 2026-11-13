import type { SqlDatabase } from '@orot/storage';

/** Claims are stored in the protected database and contain no answer text. */
export function createReplyNotificationLedger(database: SqlDatabase) {
  let ready: Promise<unknown> | undefined;
  const ensure = () =>
    (ready ??= database
      .execute(
        "CREATE TABLE IF NOT EXISTS reply_notification_claims (request_id TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending', 'started', 'done', 'retry')))",
      )
      .catch(error => {
        ready = undefined;
        throw error;
      }));
  return {
    async claim(requestId: string, eligible = true): Promise<boolean> {
      if (!requestId) throw new Error('Invalid reply identity.');
      await ensure();
      let claimed = false;
      await database.transaction(async tx => {
        const existing = await tx.execute(
          'SELECT state FROM reply_notification_claims WHERE request_id = ?',
          [requestId],
        );
        if (existing.rows.length && existing.rows[0]?.state !== 'retry') return;
        const state = eligible ? 'pending' : 'done';
        if (existing.rows.length)
          await tx.execute(
            'UPDATE reply_notification_claims SET state = ? WHERE request_id = ?',
            [state, requestId],
          );
        else
          await tx.execute(
            'INSERT INTO reply_notification_claims (request_id, state) VALUES (?, ?)',
            [requestId, state],
          );
        claimed = eligible;
      });
      return claimed;
    },
    async release(requestId: string): Promise<void> {
      await ensure();
      await database.execute(
        "UPDATE reply_notification_claims SET state = 'retry' WHERE request_id = ?",
        [requestId],
      );
    },
    async start(requestId: string): Promise<void> {
      await ensure();
      await database.execute(
        "UPDATE reply_notification_claims SET state = 'started' WHERE request_id = ? AND state = 'pending'",
        [requestId],
      );
    },
    async finish(requestId: string): Promise<void> {
      await ensure();
      await database.execute(
        "UPDATE reply_notification_claims SET state = 'done' WHERE request_id = ?",
        [requestId],
      );
    },
    async recover(): Promise<void> {
      await ensure();
      // An uncertain OS submission is never replayed: the system may already have shown it.
      await database.transaction(async tx => {
        await tx.execute(
          "UPDATE reply_notification_claims SET state = 'retry' WHERE state = 'pending'",
        );
        await tx.execute(
          "UPDATE reply_notification_claims SET state = 'done' WHERE state = 'started'",
        );
      });
    },
    async retries(): Promise<string[]> {
      await ensure();
      const rows = await database.execute(
        "SELECT request_id FROM reply_notification_claims WHERE state = 'retry'",
      );
      return rows.rows.map(row => {
        if (typeof row.request_id !== 'string')
          throw new Error('Invalid reply notification state.');
        return row.request_id;
      });
    },
  };
}
