import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { setupConversationToolGuards } from '../conversationToolGuards';

const owners = [
  ['conversation_invalid_parents', 'generated_conversation'],
  ['conversation_invalid_summaries', 'generated_summary'],
] as const;

test.each(owners)(
  'upgrades %s to the source index and preserves exact saved call retirement',
  async (table, kind) => {
    const { database, close } = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(database);
      for (const ddl of [
        'CREATE TABLE conversation_tool_events(session_id TEXT NOT NULL, message_id TEXT NOT NULL, run_id TEXT NOT NULL, call_id TEXT NOT NULL, PRIMARY KEY(session_id, run_id, call_id))',
        'CREATE TABLE IF NOT EXISTS agent_memory_removed_sources(source_id TEXT PRIMARY KEY)',
        'CREATE TABLE IF NOT EXISTS symptom_summary_runs(id TEXT PRIMARY KEY, result_json TEXT)',
        'CREATE TABLE IF NOT EXISTS conversation_invalid_summaries(id TEXT PRIMARY KEY)',
        'CREATE TABLE IF NOT EXISTS conversation_invalid_parents(id TEXT PRIMARY KEY)',
        'CREATE TABLE conversation_tool_removed_calls(session_id TEXT, run_id TEXT, call_id TEXT, PRIMARY KEY(session_id, run_id, call_id))',
        'CREATE TRIGGER conversation_tool_call_removed AFTER DELETE ON conversation_tool_events BEGIN INSERT OR IGNORE INTO conversation_tool_removed_calls VALUES (OLD.session_id, OLD.run_id, OLD.call_id); END',
      ])
        await database.execute(ddl);

      await database.transaction(setupConversationToolGuards);
      await database.transaction(async tx => {
        await tx.execute('DROP INDEX conversation_tool_dependency_source');
        await tx.execute(
          'CREATE INDEX conversation_tool_dependency_source ON conversation_tool_dependencies (record_kind, record_id, session_id, run_id, call_id)',
        );
        await tx.execute(`DROP TRIGGER tool_parent_${kind}`);
        await tx.execute(`CREATE TRIGGER tool_parent_${kind} AFTER INSERT ON ${table} BEGIN
          DELETE FROM conversation_tool_events WHERE EXISTS (
            SELECT 1 FROM conversation_tool_dependencies p
            WHERE p.session_id=conversation_tool_events.session_id AND p.run_id=conversation_tool_events.run_id
              AND p.call_id=conversation_tool_events.call_id AND p.record_kind='${kind}' AND p.record_id=NEW.id
          ); END`);

        for (const [session, run, call] of [
          ['selected', 'run', 'same-call'],
          ['unrelated', 'run', 'same-call'],
          ['selected', 'other-run', 'same-call'],
          ['selected', 'run', 'legacy-without-edge'],
        ])
          await tx.execute(
            'INSERT INTO conversation_tool_events VALUES (?,?,?,?)',
            [session!, 'message', run!, call!],
          );
        for (const [id, session, run, edgeKind, edgeId] of [
          ['valid', 'selected', 'run', kind, 'parent'],
          ['duplicate', 'selected', 'run', kind, 'parent'],
          ['kind', 'unrelated', 'run', 'manual_history', 'parent'],
          ['case', 'selected', 'other-run', kind, 'Parent'],
        ])
          await tx.execute(
            'INSERT INTO conversation_tool_dependencies VALUES (?,?,?,?,?,?)',
            [id!, session!, run!, 'same-call', edgeKind!, edgeId!],
          );
      });

      const read = (from: string) =>
        database.execute(
          `SELECT session_id, run_id, call_id FROM ${from} ORDER BY session_id, run_id, call_id`,
        );
      const original = (await read('conversation_tool_events')).rows;
      const trigger = async () =>
        (
          await database.execute(
            "SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?",
            [`tool_parent_${kind}`],
          )
        ).rows[0]?.sql;
      expect(await trigger()).toContain('WHERE EXISTS');
      await database.transaction(setupConversationToolGuards);
      expect(await trigger()).toContain(
        'WHERE (session_id, run_id, call_id) IN',
      );
      expect(
        (
          await database.execute(
            'PRAGMA index_info(conversation_tool_dependency_source)',
          )
        ).rows.map(row => row.name),
      ).toEqual([
        'record_id',
        'record_kind',
        'session_id',
        'run_id',
        'call_id',
      ]);
      const schema = async () =>
        (await database.execute('PRAGMA schema_version')).rows[0]
          ?.schema_version;
      const installed = await schema();
      await database.transaction(setupConversationToolGuards);
      expect(await schema()).toBe(installed);
      expect((await read('conversation_tool_events')).rows).toEqual(original);

      const insert = `INSERT INTO ${table}(id) VALUES (?)`;
      await expect(
        database.transaction(async tx => {
          await tx.execute(insert, ['parent']);
          throw new Error('synthetic rollback');
        }),
      ).rejects.toThrow('synthetic rollback');
      expect((await read('conversation_tool_events')).rows).toEqual(original);
      expect((await read('conversation_tool_removed_calls')).rows).toEqual([]);
      await database.execute(insert, ['parent']);
      const removed = {
        session_id: 'selected',
        run_id: 'run',
        call_id: 'same-call',
      };
      expect((await read('conversation_tool_removed_calls')).rows).toEqual([
        removed,
      ]);
      expect((await read('conversation_tool_events')).rows).toEqual(
        original.filter(
          row =>
            !(
              row.session_id === removed.session_id &&
              row.run_id === removed.run_id &&
              row.call_id === removed.call_id
            ),
        ),
      );
      expect(
        (await read('conversation_tool_dependencies')).rows,
      ).not.toContainEqual(removed);
    } finally {
      close();
    }
  },
);
