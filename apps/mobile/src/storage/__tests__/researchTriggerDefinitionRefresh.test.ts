import { setupResearchArtifactGuards } from '../researchArtifactGuards';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';

/** Present-table-dependent definitions must expand even after an earlier successful setup. */
test('refreshes new dependency edges and preserves real delete cascades', async () => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    await f.database.execute(
      'CREATE TABLE research_artifacts (id INTEGER PRIMARY KEY, snapshot_json TEXT)',
    );
    await f.database.execute(
      'CREATE TABLE research_artifact_invalid (id INTEGER)',
    );
    await f.database.transaction(setupResearchArtifactGuards);
    const original = await f.database.execute(
      "SELECT sql FROM sqlite_master WHERE name='research_artifact_delete_descendants'",
    );
    const version = await f.database.execute('PRAGMA schema_version');
    await f.database.transaction(setupResearchArtifactGuards);
    expect(await f.database.execute('PRAGMA schema_version')).toEqual(version);
    await f.database.execute(
      'CREATE TABLE research_artifact_sources (artifact_id INTEGER, record_kind TEXT, record_id TEXT)',
    );
    await f.database.transaction(setupResearchArtifactGuards);
    expect(
      await f.database.execute(
        "SELECT sql FROM sqlite_master WHERE name='research_artifact_delete_descendants'",
      ),
    ).not.toEqual(original);
    await f.database.execute(
      "INSERT INTO research_artifacts VALUES (1, '{}'), (2, '{}')",
    );
    await f.database.execute(
      "INSERT INTO research_artifact_sources VALUES (2, 'generated_research', 'research-1')",
    );
    await f.database.execute('DELETE FROM research_artifacts WHERE id=1');
    expect(
      (await f.database.execute('SELECT id FROM research_artifacts')).rows,
    ).toEqual([]);
    expect(
      (await f.database.execute('SELECT * FROM research_artifact_sources'))
        .rows,
    ).toEqual([]);
  } finally {
    f.close();
  }
});
