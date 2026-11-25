import type { SqlExecutor } from '@orot/storage';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { writeAgentMemoryDeletionMarkers } from '../agentMemoryDeletionMarkers';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { setupConversationToolGuards } from '../conversationToolGuards';

test('upgrades the one source index atomically and preserves typed, legacy and exact tuple deletion fences', async () => {
  const f = await healthContextFixture();
  try {
    const store = createConversationArtifactStorage(f.database);
    await store.createSession('session', await store.currentGeneration());
    const firstColumn = async () =>
      (
        await f.database.execute(
          'PRAGMA index_info(conversation_tool_dependency_source)',
        )
      ).rows[0]?.name;
    await f.database.transaction(async tx => {
      await tx.execute('DROP INDEX conversation_tool_dependency_source');
      await tx.execute(
        'CREATE INDEX conversation_tool_dependency_source ON conversation_tool_dependencies (record_kind, record_id, session_id, run_id, call_id)',
      );
      await tx.execute('DROP TRIGGER tool_marker_agent_memory_removed_sources');
      await tx.execute(
        'CREATE TRIGGER tool_marker_agent_memory_removed_sources AFTER INSERT ON agent_memory_removed_sources BEGIN SELECT 1; END',
      );
    });
    await expect(
      f.database.transaction(async tx => {
        await setupConversationToolGuards(tx);
        throw new Error('synthetic schema rollback');
      }),
    ).rejects.toThrow('synthetic schema rollback');
    expect(await firstColumn()).toBe('record_kind');

    await f.database.transaction(async tx => {
      await setupConversationToolGuards(tx);
      const schema = async () =>
        (await tx.execute('PRAGMA schema_version')).rows[0]?.schema_version;
      const upgraded = await schema();
      await setupConversationToolGuards(tx);
      expect(await schema()).toBe(upgraded);
      const cases = [
        ['session', 'run', 'same-call', 'typed', ['transcript_segment']],
        [
          'session',
          'other-run',
          'same-call',
          'typed',
          ['encounter', 'identity'],
        ],
        [
          'different-session',
          'run',
          'same-call',
          'typed',
          ['identity', 'transcript_segment'],
        ],
        ['session', 'run', 'untyped-alias', 'typed', ['identity']],
        ['session', 'run', 'skip-generated', 'typed', ['generated_research']],
        [
          'session',
          'run',
          'legacy-unknown-kind',
          'legacy',
          ['retired_older_kind'],
        ],
      ] as const;
      for (const [session, run, call, record, kinds] of cases) {
        await tx.execute(
          'INSERT INTO conversation_tool_events VALUES (?, ?, ?, ?, ?, ?)',
          [session, 'message', '2026-11-22T00:00:00Z', run, call, '{}'],
        );
        for (const kind of kinds)
          await tx.execute(
            'INSERT INTO conversation_tool_dependencies VALUES (?, ?, ?, ?, ?, ?)',
            [[session, run, call].join(':'), session, run, call, kind, record],
          );
      }
    });
    expect(await firstColumn()).toBe('record_id');
    const write = (tx: SqlExecutor) =>
      writeAgentMemoryDeletionMarkers(
        tx,
        new Set(['typed', 'legacy']),
        new Map([['typed', ['transcript_segment']]]),
      );
    const remaining = async () =>
      (
        await f.database.execute(
          'SELECT session_id, run_id, call_id FROM conversation_tool_events ORDER BY session_id, run_id, call_id',
        )
      ).rows;
    expect(await remaining()).toHaveLength(6);
    await expect(
      f.database.transaction(async tx => {
        await write(tx);
        throw new Error('synthetic mutation rollback');
      }),
    ).rejects.toThrow('synthetic mutation rollback');
    expect(await remaining()).toHaveLength(6);
    expect(
      (
        await f.database.execute(
          'SELECT * FROM conversation_tool_removed_calls',
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await f.database.execute(
          "SELECT source_id FROM agent_memory_removed_sources WHERE source_id IN ('typed','legacy')",
        )
      ).rows,
    ).toEqual([]);
    await f.database.transaction(async tx => {
      await write(tx);
    });
    expect(await remaining()).toEqual([
      { session_id: 'session', run_id: 'other-run', call_id: 'same-call' },
      { session_id: 'session', run_id: 'run', call_id: 'skip-generated' },
    ]);
    const retired = await f.database.execute(
      'SELECT session_id, run_id, call_id FROM conversation_tool_removed_calls ORDER BY session_id, run_id, call_id',
    );
    expect(retired.rows).toEqual([
      { session_id: 'different-session', run_id: 'run', call_id: 'same-call' },
      { session_id: 'session', run_id: 'run', call_id: 'legacy-unknown-kind' },
      { session_id: 'session', run_id: 'run', call_id: 'same-call' },
      { session_id: 'session', run_id: 'run', call_id: 'untyped-alias' },
    ]);
    const plan = await f.database.execute(
      'EXPLAIN QUERY PLAN SELECT session_id, run_id, call_id FROM conversation_tool_dependencies WHERE record_id = ?',
      ['typed'],
    );
    expect(
      plan.rows.some(row =>
        /SEARCH.*conversation_tool_dependency_source/.test(String(row.detail)),
      ),
    ).toBe(true);
  } finally {
    f.close();
  }
});
