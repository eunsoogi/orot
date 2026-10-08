import { openEncryptedStorage } from '../src';
import type { SqlDatabase } from '../src';
import { createDatabase, options } from './sourceEvidenceTestSupport';

describe('bounded local query migration', () => {
  let database: SqlDatabase;

  beforeEach(() => {
    database = createDatabase();
  });

  afterEach(async () => database.closeAsync?.());

  it('replaces version-seven date indexes with nanosecond-precise query indexes', async () => {
    await database.execute(
      'CREATE TABLE health_observations (id TEXT PRIMARY KEY NOT NULL, effective_at TEXT NOT NULL, recorded_at TEXT, ingested_at TEXT NOT NULL, payload_json TEXT NOT NULL CHECK (json_valid(payload_json)))',
    );
    await database.execute(
      "CREATE INDEX health_observations_local_query_idx ON health_observations (json_extract(payload_json, '$.provenance.origin'), json_extract(payload_json, '$.provenance.source.system'), json_extract(payload_json, '$.concept'), julianday(effective_at), id)",
    );
    await database.execute('PRAGMA user_version = 7');

    await openEncryptedStorage(options(database));

    const index = await database.execute(
      "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'health_observations_local_query_idx'",
    );
    expect(index.rows[0].sql).toContain("strftime('%s'");
    expect(index.rows[0].sql).not.toContain('julianday');
    expect((await database.execute('PRAGMA user_version')).rows[0].user_version).toBe(9);
  });
});
