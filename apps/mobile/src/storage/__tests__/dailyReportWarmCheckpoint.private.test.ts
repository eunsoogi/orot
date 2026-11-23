import { readHealthContextGeneration } from '../../healthEvidence/healthContext/generation';
import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { createDailyReportWarmCheckpoint } from '../dailyReportPreDispatchCheckpoint';
const current = () => true;
const at = '2035-01-01T01:00:00.000Z';
const identity = {
  requestId: 'exact',
  sessionId: 'session',
  sessionVersion: 0,
  fingerprint: 'exact-internal',
};
async function fixture() {
  const db = openSqliteTestDatabase(':memory:');
  await runMigrations(db.database);
  const storage = createConversationArtifactStorage(db.database);
  await storage.createSession('session', 0);
  await storage.startRequest({
    id: 'exact',
    sessionId: 'session',
    sessionVersion: 0,
    question: 'synthetic',
    createdAt: at,
  });
  const owner = createDailyReportWarmCheckpoint(db.database, identity);
  return { db, storage, owner };
}
test('declined owner is read-only; exact pause and claim remain one-use until dispatch possible', async () => {
  const f = await fixture();
  try {
    expect(await f.owner.arm(() => false)).toBe(false);
    expect(
      (
        await f.db.database.execute(
          "SELECT name FROM sqlite_master WHERE name = 'daily_report_warm_checkpoints'",
        )
      ).rows,
    ).toHaveLength(0);
    expect(await f.owner.arm(current)).toBe(true);
    expect(await f.owner.pause(current)).toBe(true);
    const wrong = createDailyReportWarmCheckpoint(f.db.database, {
      ...identity,
      fingerprint: 'different',
    });
    expect(await wrong.claim(current)).toBe(false);
    expect(await f.owner.claim(current)).toBe(true);
    expect(await f.owner.claim(current)).toBe(false);
    expect(
      await f.owner.markDispatchPossible(
        current,
        await readHealthContextGeneration(f.db.database),
      ),
    ).toBe(true);
    expect(await f.owner.pause(current)).toBe(false);
    expect(await f.owner.claim(current)).toBe(false);
    expect(
      await f.owner.markDispatchPossible(
        current,
        await readHealthContextGeneration(f.db.database),
      ),
    ).toBe(false);
  } finally {
    f.db.close();
  }
});
test.each(['user-stopped', 'cancelled', 'removed'] as const)(
  'paused state cannot survive %s',
  async reason => {
    const f = await fixture();
    try {
      expect(await f.owner.arm(current)).toBe(true);
      expect(await f.owner.pause(current)).toBe(true);
      if (reason === 'removed')
        await f.db.database.execute(
          "DELETE FROM conversation_requests WHERE id = 'exact'",
        );
      else
        await f.storage.interruptRequest(
          'exact',
          'session',
          0,
          reason === 'cancelled' ? 'cancelled' : 'interrupted',
          reason === 'user-stopped' ? 'user-stopped' : undefined,
        );
      expect(await f.owner.claim(current)).toBe(false);
      expect(
        (
          await f.db.database.execute(
            'SELECT request_id FROM daily_report_warm_checkpoints',
          )
        ).rows,
      ).toHaveLength(0);
    } finally {
      f.db.close();
    }
  },
);
