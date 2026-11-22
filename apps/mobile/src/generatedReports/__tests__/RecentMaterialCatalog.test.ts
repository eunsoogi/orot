import {
  createManualHistoryRepository,
  localConversationMemoryIdPrefix,
  runMigrations,
} from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationSessionVisibility } from '../../storage/conversationSessionVisibility';
import { subscribeConversationVisibility } from '../../storage/conversationVisibilityEvents';
import { listGeneratedReports, listRecentMaterial } from '../catalog';

test('pages across protected metadata only and hides superseded, cleared and unavailable items', async () => {
  const f = openSqliteTestDatabase(':memory:');
  const clock = '2026-11-22T11:00:00.000Z';
  try {
    await runMigrations(f.database);
    const memoryId = localConversationMemoryIdPrefix + 'first';
    const correctedId = localConversationMemoryIdPrefix + 'corrected';
    const memory = createManualHistoryRepository(f.database, {
      clock: () => clock,
      createId: jest
        .fn()
        .mockReturnValueOnce(memoryId)
        .mockReturnValueOnce('corrected')
        .mockReturnValueOnce('ordinary-history'),
    });
    const note = {
      kind: 'note' as const,
      title: 'SYNTHETIC PRIVATE title',
      details: 'SYNTHETIC PRIVATE details',
      effectiveDate: { status: 'unknown' as const },
    };
    await memory.create(note);
    await memory.correct(memoryId, note);
    await memory.create(note);
    await f.database.execute(
      'CREATE TABLE visit_period_policy(question_id TEXT, status TEXT)',
    );
    for (let i = 0; i < 24; i += 1) {
      const id = String(i).padStart(3, '0');
      await f.database.execute(
        'INSERT INTO visit_questions(id,effective_at,recorded_at,ingested_at,payload_json) VALUES (?,?,?,?,?)',
        [
          id,
          clock,
          i === 0 ? '2026-11-22T20:30:00+09:00' : clock,
          clock,
          JSON.stringify({
            appointmentId: id,
            questionText: 'SYNTHETIC PRIVATE question',
          }),
        ],
      );
    }
    await f.database.execute(
      "INSERT INTO visit_period_policy VALUES ('023', 'quarantined')",
    );
    await f.database.execute(
      'CREATE TABLE conversation_artifact_sessions(id TEXT, hidden INT, generation INT, version INT DEFAULT 0)',
    );
    await f.database.execute(
      'CREATE TABLE conversation_artifact_generation(singleton INT, generation INT)',
    );
    await f.database.execute(
      'CREATE TABLE conversation_artifacts(id TEXT, session_id TEXT, created_at TEXT, result_json TEXT)',
    );
    await f.database.execute(
      'CREATE TABLE conversation_invalid_parents(id TEXT)',
    );
    await f.database.execute(
      'CREATE TABLE conversation_deleted_artifacts(id TEXT)',
    );
    await f.database.execute(
      'INSERT INTO conversation_artifact_generation VALUES (1,2)',
    );
    for (const [id, hidden, generation] of [
      ['kept', 0, 2],
      ['hidden', 1, 2],
      ['deleted', 0, 2],
      ['invalid', 0, 2],
      ['old-generation', 0, 1],
    ] as const) {
      await f.database.execute(
        'INSERT INTO conversation_artifact_sessions(id,hidden,generation) VALUES (?,?,?)',
        [id, hidden, generation],
      );
      await f.database.execute(
        'INSERT INTO conversation_artifacts VALUES (?,?,?,?)',
        [
          id,
          id,
          clock,
          JSON.stringify({
            status: 'complete',
            entryIntent: 'possibilities',
            result: 'SYNTHETIC PRIVATE report',
          }),
        ],
      );
    }
    await f.database.execute(
      "INSERT INTO conversation_deleted_artifacts VALUES ('deleted')",
    );
    await f.database.execute(
      "INSERT INTO conversation_invalid_parents VALUES ('invalid')",
    );

    const first = await listRecentMaterial(f.database);
    const cursor = first.at(-1)!;
    const second = await listRecentMaterial(f.database, cursor);
    const all = [...first, ...second];
    const keys = all.map(row => row.key);
    expect(first).toHaveLength(20);
    expect(second).toHaveLength(5);
    expect(new Set(keys).size).toBe(25);
    expect(keys[0]).toBe('visit:000'); // +09:00 is actually 30 minutes newer than UTC rows.
    expect(keys.at(-1)).toBe('conversation:kept');
    expect(all.find(row => row.origin === 'memory')).toEqual({
      key: 'memory:' + correctedId,
      id: 'manual-history:' + correctedId,
      origin: 'memory',
      createdAt: clock,
    });
    expect(keys).not.toContain('visit:023');
    expect(keys).not.toContain('memory:' + memoryId);
    expect(keys).not.toContain('memory:ordinary-history');
    expect(keys.filter(key => key.startsWith('conversation:'))).toEqual([
      'conversation:kept',
    ]);
    expect(JSON.stringify(all)).not.toContain('SYNTHETIC PRIVATE');
    expect(
      (await listGeneratedReports(f.database)).map(row => row.key),
    ).not.toContain('memory:' + correctedId);
    const visibility = createConversationSessionVisibility(
      f.database,
      async () => {},
    );
    const changed = jest.fn(() => listRecentMaterial(f.database, cursor));
    const detach = subscribeConversationVisibility(changed);
    try {
      await expect(visibility.hideSession('kept')).resolves.toBe(1);
      expect(changed).toHaveBeenCalledTimes(1);
      const observed:
        Awaited<ReturnType<typeof listRecentMaterial>> | undefined =
        await changed.mock.results[0]?.value;
      expect(observed?.some(row => row.key === 'conversation:kept')).toBe(
        false,
      );
      await expect(visibility.hideSession('kept')).resolves.toBe(1);
      expect(changed).toHaveBeenCalledTimes(1);
    } finally {
      detach();
    }
    await memory.delete(correctedId);
    const after = await listRecentMaterial(
      f.database,
      (await listRecentMaterial(f.database)).at(-1)!,
    );
    expect(after.some(row => row.origin === 'memory')).toBe(false);
  } finally {
    f.close();
  }
});
