import type { SqlDatabase } from '@orot/storage';

/** Claims are stored in the protected database and contain no answer text. */
export function createReplyNotificationLedger(database: SqlDatabase) {
  let ready: Promise<unknown> | undefined;
  const ensure = () =>
    (ready ??= database
      .execute(
        'CREATE TABLE IF NOT EXISTS reply_notification_claims (request_id TEXT PRIMARY KEY NOT NULL)',
      )
      .catch(error => {
        ready = undefined;
        throw error;
      }));
  return {
    async claim(requestId: string): Promise<boolean> {
      if (!requestId) throw new Error('Invalid reply identity.');
      await ensure();
      let claimed = false;
      await database.transaction(async tx => {
        const existing = await tx.execute(
          'SELECT request_id FROM reply_notification_claims WHERE request_id = ?',
          [requestId],
        );
        if (existing.rows.length) return;
        await tx.execute(
          'INSERT INTO reply_notification_claims (request_id) VALUES (?)',
          [requestId],
        );
        claimed = true;
      });
      return claimed;
    },
  };
}
