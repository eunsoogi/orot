import { createManualHistoryRepository } from '@orot/storage';
import { setupConversationToolGuards } from '../conversationToolGuards';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';

test('deleting a source removes its completed answer, request prompt, and completion', async () => {
  const f = await healthContextFixture();
  try {
    const store = createConversationArtifactStorage(f.database);
    await store.createSession('session', await store.currentGeneration());
    const request = {
      id: 'request',
      sessionId: 'session',
      sessionVersion: 0,
      question: 'Synthetic question',
      createdAt: '2026-11-13T00:00:00.000Z',
    };
    await store.startRequest(request);
    await store.append({
      id: request.id,
      sessionId: request.sessionId,
      question: request.question,
      createdAt: request.createdAt,
      providerId: 'provider',
      modelId: 'model',
      status: 'complete',
      answer: 'Synthetic answer',
      sources: f.saved.sources,
    });
    const identity = {
      requestId: request.id,
      sessionId: request.sessionId,
      messageId: request.id,
      sessionVersion: 0,
    };
    expect(await store.readCommittedCompletion(identity)).toBe(
      'Synthetic answer',
    );
    await f.repository.delete('health_observation', f.inside.id);
    expect(await store.readCommittedCompletion(identity)).toBeNull();
    expect(await store.read(request.id)).toBeNull();
    expect(await store.listCompletionIdentities()).toEqual([]);
    expect(
      (
        await f.database.execute(
          'SELECT id FROM conversation_requests WHERE id = ?',
          [request.id],
        )
      ).rows,
    ).toEqual([]);
  } finally {
    f.close();
  }
});

test('upgrades manual-history deletion to a typed covering lookup without weakening call retirement', async () => {
  const f = await healthContextFixture();
  try {
    const store = createConversationArtifactStorage(f.database);
    await store.createSession('session', await store.currentGeneration());
    const manual = createManualHistoryRepository(f.database);
    const original = await manual.create({
      kind: 'note',
      title: 'Synthetic memory',
      details: 'Synthetic note',
      effectiveDate: { status: 'unknown' },
    });
    await f.database.transaction(async tx => {
      await tx.execute('DROP TRIGGER tool_source_removed_manual_history');
      await tx.execute(`CREATE TRIGGER tool_source_removed_manual_history AFTER DELETE ON manual_history_entries BEGIN
        DELETE FROM conversation_tool_events WHERE EXISTS (SELECT 1 FROM conversation_tool_dependencies p
        WHERE p.session_id=conversation_tool_events.session_id AND p.run_id=conversation_tool_events.run_id AND
        p.call_id=conversation_tool_events.call_id AND p.record_kind='manual_history' AND p.record_id=OLD.id); END`);
      await setupConversationToolGuards(tx);
      const schemaVersion = async () =>
        (await tx.execute('PRAGMA schema_version')).rows[0]?.schema_version;
      const installedVersion = await schemaVersion();
      await setupConversationToolGuards(tx);
      expect(await schemaVersion()).toBe(installedVersion);
      for (const [session, run, call, kind] of [
        ['session', 'run', 'same-id', 'manual_history'],
        ['session', 'other-run', 'same-id', 'health_observation'],
        ['elsewhere', 'run', 'same-id', 'research_artifact'],
      ]) {
        await tx.execute(
          'INSERT INTO conversation_tool_events VALUES (?, ?, ?, ?, ?, ?)',
          [session!, 'message', original.recordedAt, run!, call!, '{}'],
        );
        await tx.execute(
          'INSERT INTO conversation_tool_dependencies VALUES (?,?,?,?,?,?)',
          [
            [session, run, call].join(':'),
            session!,
            run!,
            call!,
            kind!,
            original.id,
          ],
        );
      }
    });
    await expect(
      f.database.transaction(async tx => {
        expect(await manual.delete(original.id, tx)).toBe(true);
        throw new Error('synthetic rollback');
      }),
    ).rejects.toThrow('synthetic rollback');
    const remaining = () =>
      f.database.execute(
        'SELECT session_id, run_id FROM conversation_tool_events ORDER BY session_id, run_id',
      );
    expect((await remaining()).rows).toHaveLength(3);
    await expect(manual.delete(original.id)).resolves.toBe(true);
    expect((await remaining()).rows).toEqual([
      { session_id: 'elsewhere', run_id: 'run' },
      { session_id: 'session', run_id: 'other-run' },
    ]);
    expect(
      (
        await f.database.execute(
          'SELECT * FROM conversation_tool_removed_calls',
        )
      ).rows,
    ).toEqual([{ session_id: 'session', run_id: 'run', call_id: 'same-id' }]);
    const plan = await f.database.execute(
      "EXPLAIN QUERY PLAN SELECT session_id, run_id, call_id FROM conversation_tool_dependencies WHERE record_kind='manual_history' AND record_id=?",
      [original.id],
    );
    expect(
      plan.rows.some(row =>
        String(row.detail).includes('conversation_tool_dependency_source'),
      ),
    ).toBe(true);
  } finally {
    f.close();
  }
});
