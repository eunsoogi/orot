import { createDailyReportIdentity } from '@orot/domain';
import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';

const identity = createDailyReportIdentity('2026-11-10', 'Asia/Seoul');
const createdAt = '2026-11-10T03:00:00.000Z';
const task = { kind: 'daily_report' as const, identity };

test('competing updates cannot both replace the same saved task revision', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    await storage.createSession('session', await storage.currentGeneration());
    const input = {
      sessionId: 'session',
      sessionVersion: 0,
      id: 'task',
      createdAt,
      expectedRevision: null,
      task,
    };
    await storage.writeTaskCard(input);
    const first = {
      ...task,
      report: { identity, runId: 'first', revision: 1 },
    };
    const second = {
      ...task,
      report: { identity, runId: 'second', revision: 1 },
    };
    const outcomes = await Promise.allSettled([
      storage.writeTaskCard({ ...input, expectedRevision: 1, task: first }),
      storage.writeTaskCard({ ...input, expectedRevision: 1, task: second }),
    ]);
    expect(outcomes.filter(item => item.status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(outcomes.filter(item => item.status === 'rejected')).toHaveLength(1);
    const rejected = outcomes.find(item => item.status === 'rejected');
    expect(rejected).toMatchObject({
      reason: expect.objectContaining({ message: 'Task card changed.' }),
    });
    const [saved] = await storage.readTaskCards('session', 0);
    expect(saved?.revision).toBe(2);
    expect([first, second]).toContainEqual(saved?.task);
  } finally {
    connection.close();
  }
});
