import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createReplyNotificationLedger } from '../replyNotificationLedger';
const { mkdtempSync, rmSync } = require('node:fs') as {
  mkdtempSync(prefix: string): string;
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
};
const { tmpdir } = require('node:os') as { tmpdir(): string };
const { join } = require('node:path') as { join(...parts: string[]): string };

test('claims survive reopening and remain distinct across requests', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'reply-ledger-'));
  const path = join(directory, 'ledger.sqlite');
  let connection = openSqliteTestDatabase(path);
  try {
    const first = createReplyNotificationLedger(connection.database);
    expect(await first.claim('first')).toBe(true);
    connection.close();
    connection = openSqliteTestDatabase(path);
    const reopened = createReplyNotificationLedger(connection.database);
    expect(await reopened.claim('first')).toBe(false);
    expect(await reopened.claim('second')).toBe(true);
    expect(
      (
        await Promise.all([reopened.claim('third'), reopened.claim('third')])
      ).sort(),
    ).toEqual([false, true]);
  } finally {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
