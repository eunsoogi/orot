import { createDailyReportIdentity } from '@orot/domain';
import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';

// Real SQLite reopening proves the discriminator and historical zone survive durable storage.
test('a reminder card survives reopening without a health payload or date substitution', async () => {
  const { mkdtempSync, rmSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const directory = mkdtempSync(join(tmpdir(), 'orot-reminder-task-'));
  const path = join(directory, 'database.sqlite');
  let connection = openSqliteTestDatabase(path);
  const task = {
    kind: 'daily_report' as const,
    identity: createDailyReportIdentity('2023-11-15', 'Asia/Seoul'),
    reminder: true as const,
  };
  const card = {
    id: 'synthetic-reminder',
    createdAt: '2023-11-15T12:00:00.000Z',
    revision: 1,
    task,
  };
  try {
    await runMigrations(connection.database);
    let storage = createConversationArtifactStorage(connection.database);
    await storage.createSession('session', await storage.currentGeneration());
    await storage.writeTaskCard({
      sessionId: 'session',
      sessionVersion: 0,
      ...card,
      expectedRevision: null,
    });
    connection.close();
    connection = openSqliteTestDatabase(path);
    storage = createConversationArtifactStorage(connection.database);
    expect(await storage.readTaskCards('session', 0)).toEqual([card]);
  } finally {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
