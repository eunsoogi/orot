import { ensurePeriodRemovalIndexes } from '../../storage/periodRemovalIndexes';
import type { SqlExecutor } from '@orot/storage';
import { localQueryTimestampKeyExpression } from '@orot/storage';

const tables = [
  'health_observations',
  'medication_definitions',
  'medication_assertions',
  'dose_events',
  'symptom_entries',
  // Daily reports admit confirmed appointments; their changes must fence saves.
  'appointments',
] as const;

/** A single constant-size generation row fences deletion races and invalidates cached aggregates, without retaining deleted health data. */
export async function ensureHealthContextGeneration(
  executor: SqlExecutor,
): Promise<void> {
  await executor.execute(
    'CREATE TABLE IF NOT EXISTS health_context_generation (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), mutations INTEGER NOT NULL, deletions INTEGER NOT NULL)',
  );
  await executor.execute(
    'INSERT OR IGNORE INTO health_context_generation (singleton, mutations, deletions) VALUES (1, 0, 0)',
  );
  // A deletion intent hides the source before its row is removed, invalidating cached aggregates.
  await executor.execute(
    'CREATE TRIGGER IF NOT EXISTS health_context_symptom_fenced AFTER INSERT ON legacy_symptom_deleted BEGIN UPDATE health_context_generation SET mutations = mutations + 1, deletions = deletions + 1 WHERE singleton = 1; END',
  );
  // Concept and exact-instant bounds apply before period aggregation, independently of total imported history.
  await executor.execute(
    `CREATE INDEX IF NOT EXISTS health_context_quantity_time ON health_observations (json_extract(payload_json, '$.concept'), ${localQueryTimestampKeyExpression('effective_at')})`,
  );
  // Generic measurement concepts cannot use the leading concept key of the older index.
  await executor.execute(
    `CREATE INDEX IF NOT EXISTS health_context_observation_time ON health_observations (${localQueryTimestampKeyExpression('effective_at')})`,
  );
  await executor.execute(
    `CREATE INDEX IF NOT EXISTS health_context_dose_time ON dose_events (${localQueryTimestampKeyExpression('effective_at')})`,
  );
  await executor.execute(
    `CREATE INDEX IF NOT EXISTS health_context_symptom_time ON symptom_entries (${localQueryTimestampKeyExpression("coalesce(json_extract(payload_json, '$.startedAt'), effective_at)")})`,
  );
  // Activity selection is case-normalized, so its index must use the identical
  // expression; the raw-concept index cannot narrow lower(concept) IN lookups.
  await executor.execute(
    `CREATE INDEX IF NOT EXISTS health_context_activity_time ON health_observations (lower(json_extract(payload_json, '$.concept')), ${localQueryTimestampKeyExpression('effective_at')})`,
  );
  // Availability asks for the first admitted row in each kind. These exact-time
  // indexes let its per-kind minimum stop before scanning an entire catalog.
  await executor.execute(
    `CREATE INDEX IF NOT EXISTS health_context_assertion_time ON medication_assertions (${localQueryTimestampKeyExpression('effective_at')})`,
  );
  await executor.execute(
    `CREATE INDEX IF NOT EXISTS health_context_registration_time ON medication_definitions (${localQueryTimestampKeyExpression('coalesce(effective_at, ingested_at)')})`,
  );
  await ensurePeriodRemovalIndexes(executor);
  for (const table of tables) {
    for (const event of ['INSERT', 'UPDATE', 'DELETE'] as const) {
      await executor.execute(`CREATE TRIGGER IF NOT EXISTS health_context_${table}_${event.toLowerCase()}
        AFTER ${event} ON ${table} BEGIN
        UPDATE health_context_generation SET mutations = mutations + 1, deletions = deletions + ${event === 'DELETE' ? 1 : 0} WHERE singleton = 1;
        END`);
    }
  }
  // Transcript correction invalidates derived health artifacts without updating their original rows.
  const kinds =
    "('health_observation', 'medication_definition', 'medication_assertion', 'dose_event', 'symptom_entry')";
  for (const event of ['INSERT', 'UPDATE', 'DELETE'] as const) {
    const guard =
      event === 'INSERT'
        ? `NEW.artifact_kind IN ${kinds}`
        : event === 'DELETE'
          ? `OLD.artifact_kind IN ${kinds}`
          : `NEW.artifact_kind IN ${kinds} OR OLD.artifact_kind IN ${kinds}`;
    await executor.execute(`CREATE TRIGGER IF NOT EXISTS health_context_staleness_${event.toLowerCase()} AFTER ${event} ON transcript_artifact_staleness WHEN ${guard} BEGIN
      UPDATE health_context_generation SET mutations = mutations + 1, deletions = deletions + ${event === 'DELETE' ? 0 : 1} WHERE singleton = 1; END`);
  }
}

export async function readHealthContextGeneration(executor: SqlExecutor) {
  const result = await executor.execute(
    'SELECT mutations, deletions FROM health_context_generation WHERE singleton = 1',
  );
  const row = result.rows[0];
  if (
    !row ||
    !['mutations', 'deletions'].every(
      key =>
        typeof row[key] === 'number' &&
        Number.isSafeInteger(row[key]) &&
        Number(row[key]) >= 0,
    )
  )
    throw new Error('Health context generation is unavailable.');
  return {
    mutationGeneration: row.mutations as number,
    deletionGeneration: row.deletions as number,
  };
}
