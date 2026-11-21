import { createDailyReportIdentity } from '@orot/domain';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { conversationPreviewSchemaSnapshot } from '../conversationPreviewSchema';
import { setupConversationVoiceEndMarkers } from '../conversationVoiceEndStorage';

const owner = 'voice-owner';
const time = '2026-11-20T04:00:00.000Z';
const marker = {
  sessionId: owner,
  sessionVersion: 0,
  id: 'voice-end:call-1',
  createdAt: time,
  expectedRevision: null,
  task: { kind: 'voice_end' as const, durationSeconds: 134 },
};

test('a voice-end marker is an immutable protected task on the existing bounded mixed timeline', async () => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(f.database);
    const storage = createConversationArtifactStorage(f.database);
    const generation = await storage.currentGeneration();
    await storage.createSession(owner, generation);
    await storage.createSession('next-conversation', generation);
    await storage.writeTaskCard({
      ...marker,
      id: 'report',
      task: {
        kind: 'daily_report',
        identity: createDailyReportIdentity('2026-11-20', 'Etc/UTC'),
      },
    });
    for (const id of ['zz-turn', 'aa-turn']) {
      await f.database.execute(
        "INSERT INTO conversation_requests (id, session_id, session_version, question, created_at, status) VALUES (?, ?, ?, ?, ?, 'interrupted')",
        [id, owner, 0, 'synthetic question', time],
      );
    }
    const saved = await storage.writeTaskCard(marker);
    expect(
      (
        await f.database.execute(
          'SELECT id FROM conversation_task_cards WHERE session_id = ?',
          [owner],
        )
      ).rows,
    ).toEqual([{ id: 'report' }]);
    expect((await storage.listSessions()).items).toEqual([
      expect.objectContaining({ id: owner }),
    ]);
    expect(await storage.writeTaskCard(marker)).toEqual(saved);
    await expect(
      storage.writeTaskCard({
        ...marker,
        task: { ...marker.task, durationSeconds: 139 },
      }),
    ).rejects.toThrow();
    await expect(
      storage.writeTaskCard({ ...marker, expectedRevision: 1 }),
    ).rejects.toThrow();

    const reopened = createConversationArtifactStorage(f.database);
    const page = await reopened.listTimeline(owner, 0, undefined, 2);
    expect(page.items.map(item => [item.id, item.kind])).toEqual([
      ['zz-turn', 'turn'],
      [marker.id, 'task'],
    ]);
    expect(JSON.stringify(page)).not.toContain('durationSeconds');
    const prior = await reopened.listTimeline(owner, 0, page.nextCursor!, 2);
    expect(prior.items.map(item => item.id)).toEqual(['report', 'aa-turn']);
    expect(prior.nextCursor).toBeNull();
    expect(await reopened.readTaskCards(owner, 0, [marker.id])).toEqual([
      saved,
    ]);
    expect(await reopened.readTaskCards('next-conversation', 0)).toEqual([]);
    expect(await reopened.readToolTurns(owner, 0, [marker.id])).toEqual([]);
  } finally {
    f.close();
  }
});

test('invalid receipt content and superseded leases cannot write voice-end history', async () => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(f.database);
    const storage = createConversationArtifactStorage(f.database);
    const generation = await storage.currentGeneration();
    await storage.createSession(owner, generation);
    for (const task of [
      { ...marker.task, text: 'synthetic private text' },
      { ...marker.task, durationSeconds: -1 },
      { ...marker.task, durationSeconds: 0.5 },
    ]) {
      await expect(
        storage.writeTaskCard({ ...marker, task }),
      ).rejects.toThrow();
    }
    await expect(
      storage.writeTaskCard({ ...marker, id: 'report' }),
    ).rejects.toThrow();
    await storage.writeTaskCard(marker);
    const hidden = await storage.hideSession(owner, 0);
    const version = await storage.undoHiddenSession(owner, hidden!);
    await expect(
      storage.writeTaskCard({ ...marker, id: 'voice-end:stale' }),
    ).rejects.toThrow();
    expect(await storage.readTaskCards(owner, version)).toHaveLength(1);
    await storage.deleteSession(owner);
    expect(
      (
        await f.database.execute(
          'SELECT id FROM conversation_voice_end_markers',
        )
      ).rows,
    ).toEqual([]);
    await expect(storage.writeTaskCard(marker)).rejects.toThrow();
    await storage.createSession('another-voice', generation);
    await storage.writeTaskCard({ ...marker, sessionId: 'another-voice' });
    await createRecordRepository(f.database).deleteAllLocalData();
    expect(
      (
        await f.database.execute(
          'SELECT id FROM conversation_voice_end_markers',
        )
      ).rows,
    ).toEqual([]);
    await expect(storage.listTimeline('another-voice', 0)).rejects.toThrow();
  } finally {
    f.close();
  }
});

test('an unrelated protected preview schema fingerprint stays compatible when only the voice sidecar is installed', async () => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(f.database);
    const storage = createConversationArtifactStorage(f.database);
    await storage.currentGeneration();
    await f.database.execute(
      'DROP TRIGGER conversation_voice_end_markers_session_removed',
    );
    await f.database.execute('DROP TABLE conversation_voice_end_markers');
    const before = await conversationPreviewSchemaSnapshot(f.database);
    expect(before).not.toBeNull();
    await f.database.transaction(setupConversationVoiceEndMarkers);
    expect(await conversationPreviewSchemaSnapshot(f.database)).toEqual(before);
    const plan = await f.database.execute(
      'EXPLAIN QUERY PLAN SELECT id, created_at FROM conversation_voice_end_markers WHERE session_id = ? ORDER BY created_at, id',
      [owner],
    );
    expect(plan.rows.map(row => row.detail).join(' ')).toMatch(
      /SEARCH.*voice_end.*INDEX/,
    );
  } finally {
    f.close();
  }
});
