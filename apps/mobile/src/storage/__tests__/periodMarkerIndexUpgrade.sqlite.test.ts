import { runMigrations, type SqlDatabase } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { setupConversationToolGuards } from '../conversationToolGuards';
import { indexedMarkerPeriodTables } from '../markerPeriodContributors';
import {
  ensurePeriodRemovalIndexes,
  periodRemovalIndexDefinitions,
  periodRecordingIndex,
} from '../periodRemovalIndexes';

const health = 'health_observations';
const dose = 'dose_events';

async function createToolTables(database: SqlDatabase) {
  await runMigrations(database);
  for (const sql of [
    'CREATE TABLE IF NOT EXISTS conversation_tool_events(session_id TEXT,run_id TEXT,call_id TEXT,message_id TEXT,PRIMARY KEY(session_id,run_id,call_id))',
    'CREATE TABLE IF NOT EXISTS manual_history_entries(id TEXT PRIMARY KEY,payload_json TEXT,supersedes_id TEXT)',
    'CREATE TABLE IF NOT EXISTS agent_memory_removed_sources(source_id TEXT PRIMARY KEY)',
    'CREATE TABLE IF NOT EXISTS symptom_summary_runs(id TEXT PRIMARY KEY,result_json TEXT)',
    'CREATE TABLE IF NOT EXISTS conversation_invalid_summaries(id TEXT)',
    'CREATE TABLE IF NOT EXISTS conversation_invalid_parents(id TEXT)',
  ])
    await database.execute(sql);
}

async function installedTrigger(database: SqlDatabase, table: string) {
  return (
    await database.execute(
      "SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?",
      [`tool_period_${table}_agent_memory_removed_sources`],
    )
  ).rows[0]?.sql;
}

test('upgrades existing triggers only for exact owning index schemas; mixed layouts install stock fallback', async () => {
  const { database, close } = openSqliteTestDatabase(':memory:');
  try {
    await createToolTables(database);
    await database.execute(
      "INSERT INTO conversation_tool_events(session_id,run_id,call_id,message_id) VALUES ('existing-session','existing-run','existing-call','existing-message')",
    );
    // Existing catalog from an older app may have a stale or absent recording index.
    await database.execute(`DROP INDEX IF EXISTS ${periodRecordingIndex.name}`);
    const initialize = () => database.transaction(setupConversationToolGuards);
    await initialize();
    const stock = await installedTrigger(database, health);
    expect(stock).toContain('LEFT JOIN transcript_segments');
    expect(stock).not.toContain('roots.identity');

    await ensurePeriodRemovalIndexes(database);
    await initialize();
    const indexed = await installedTrigger(database, health);
    expect(indexed).toContain('roots.identity');
    expect((await indexedMarkerPeriodTables(database)).size).toBe(5);
    for (const index of [
      'conversation_tool_dependency_call',
      'conversation_tool_period_call',
    ])
      expect(
        (await database.execute(`PRAGMA index_info(${index})`)).rows.map(
          row => row.name,
        ),
      ).toEqual(['session_id', 'run_id', 'call_id']);
    await initialize();
    expect(await installedTrigger(database, health)).toBe(indexed);

    const [singleton, fallback] = periodRemovalIndexDefinitions(health);
    if (!singleton || !fallback) throw new Error('Fixture definitions missing');
    await database.execute(`DROP INDEX ${singleton.name}`);
    // Same name and owning table, but not the indexed JSON expression.
    await database.execute(`CREATE INDEX ${singleton.name} ON ${health}(id)`);
    await initialize();
    expect(await installedTrigger(database, health)).toBe(stock);
    expect(await installedTrigger(database, dose)).toContain('roots.identity');

    await database.execute(`DROP INDEX ${singleton.name}`);
    await database.execute(`DROP INDEX ${fallback.name}`);
    await database.execute(`CREATE INDEX ${fallback.name} ON ${dose}(id)`);
    await database.execute(singleton.sql);
    await initialize();
    expect(await installedTrigger(database, health)).toBe(stock);

    // Recreate correct definitions in the opposite order, proving catalog row order is not authority.
    await database.execute(`DROP INDEX ${singleton.name}`);
    await database.execute(`DROP INDEX ${fallback.name}`);
    await database.execute(fallback.sql);
    await database.execute(singleton.sql);
    await initialize();
    expect(await installedTrigger(database, health)).toBe(indexed);
    expect(
      (await database.execute('SELECT call_id FROM conversation_tool_events'))
        .rows,
    ).toEqual([{ call_id: 'existing-call' }]);

    await database.execute(`DROP INDEX ${periodRecordingIndex.name}`);
    await database.execute(
      `CREATE INDEX ${periodRecordingIndex.name} ON transcript_segments(id)`,
    );
    await initialize();
    expect(await installedTrigger(database, health)).toBe(stock);
    expect(await installedTrigger(database, dose)).not.toContain(
      'roots.identity',
    );
  } finally {
    close();
  }
});
