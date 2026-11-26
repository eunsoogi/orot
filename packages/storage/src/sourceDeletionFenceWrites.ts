import type { SqlExecutor } from './sql';

type Reference = { readonly id: string; readonly kind: string };

const marker = 'source_deletion_tombstones';
const batchSize = 128;
const identities = "SELECT json_extract(value, '$.id') FROM json_each(?)";

function referenceBatches(references: readonly Reference[]): string[] {
  const batches: string[] = [];
  for (let offset = 0; offset < references.length; offset += batchSize)
    batches.push(JSON.stringify(references.slice(offset, offset + batchSize)));
  return batches;
}

/** Stage types before the existing cascade inserts each identity. Unknown legacy
 * markers retain their wildcard; no caller admission or trigger is bypassed. */
export async function stageSourceDeletionFences(
  transaction: SqlExecutor,
  references: readonly Reference[],
) {
  const batches = referenceBatches(references);
  for (const batch of batches) {
    await transaction.execute(
      `INSERT OR IGNORE INTO typed_deletion_markers
       SELECT '${marker}', source_id, '*' FROM ${marker}
       WHERE source_id IN (${identities})
       AND NOT EXISTS (
         SELECT 1 FROM typed_deletion_markers m
         WHERE m.marker_table = '${marker}' AND m.source_id = ${marker}.source_id
       )`,
      [batch],
    );
    await transaction.execute(
      `INSERT OR IGNORE INTO typed_deletion_markers
       SELECT '${marker}', json_extract(value, '$.id'), json_extract(value, '$.kind')
       FROM json_each(?)`,
      [batch],
    );
    await transaction.execute(
      `INSERT OR IGNORE INTO typed_deletion_write_context
       SELECT '${marker}', json_extract(value, '$.id') FROM json_each(?)`,
      [batch],
    );
    // The original cascade reinserts these exact fences so listeners observe the new type set.
    await transaction.execute(`DELETE FROM ${marker} WHERE source_id IN (${identities})`, [batch]);
  }
  return async () => {
    for (const batch of batches)
      await transaction.execute(
        `DELETE FROM typed_deletion_write_context
         WHERE marker_table = '${marker}' AND source_id IN (${identities})`,
        [batch],
      );
  };
}
