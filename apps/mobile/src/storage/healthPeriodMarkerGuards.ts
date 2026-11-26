import { STORAGE_TABLES, type SqlExecutor } from '@orot/storage';
import {
  healthPeriodDeletionGuards,
  replaceHealthPeriodTrigger,
} from './healthPeriodDependencies';
import {
  indexedMarkerPeriodTables,
  markerPeriodContributorMatches,
} from './markerPeriodContributors';
import { ensureTypedDeletionMarkers } from './typedDeletionMarkers';

/** Logical deletion precedes row removal. Match typed direct and provenance identities
 * while the contributing rows still exist, rather than relying only on later reaggregation. */
export async function setupHealthPeriodMarkerGuards(
  tx: SqlExecutor,
  prefix: string,
  remove: (condition: string) => string,
) {
  for (const table of [
    'source_deletion_tombstones',
    'agent_memory_removed_sources',
  ])
    await tx.execute(
      `CREATE TABLE IF NOT EXISTS ${table} (source_id TEXT PRIMARY KEY NOT NULL)`,
    );
  await ensureTypedDeletionMarkers(tx);
  const indexedPeriods = await indexedMarkerPeriodTables(tx);
  for (const [table, guard] of Object.entries(healthPeriodDeletionGuards())) {
    const kind = Object.entries(STORAGE_TABLES).find(
      ([, entry]) => entry.table === table,
    )![0];
    for (const marker of [
      'source_deletion_tombstones',
      'agent_memory_removed_sources',
    ]) {
      const condition = markerPeriodContributorMatches(
        table,
        'NEW.source_id',
        marker,
        kind,
        guard.replaceAll('OLD.', 'h.'),
        indexedPeriods.has(table),
      );
      await replaceHealthPeriodTrigger(
        tx,
        `CREATE TRIGGER ${prefix}_${table}_${marker} AFTER INSERT ON ${marker} BEGIN ${remove(condition)} END`,
      );
    }
  }
}
