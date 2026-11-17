import { runMigrations } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../localEvidenceTestSupport';
import { findEvidenceIdentifiers } from '../evidenceCandidates';

test('identifies every embedded source beyond the old redaction count ceiling', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const at = '2026-11-17T00:00:00.000Z';
    await database.execute(
      `INSERT INTO symptom_entries (id, effective_at, recorded_at, ingested_at, payload_json)
      WITH RECURSIVE n(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM n WHERE value < 1100)
      SELECT 'source-' || value, ?, ?, ?, '{}' FROM n`,
      [at, at, at],
    );
    const ids = Array.from(
      { length: 1100 },
      (_, index) => `source-${index + 1}`,
    );
    const found = await findEvidenceIdentifiers(database, ids.join(';'));
    expect(new Set(found)).toEqual(new Set(ids));
    const controller = new AbortController();
    controller.abort();
    await expect(
      findEvidenceIdentifiers(database, ids.join(';'), controller.signal),
    ).rejects.toThrow('cancelled');
  } finally {
    close();
  }
});
