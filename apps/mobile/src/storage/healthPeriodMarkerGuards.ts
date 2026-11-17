import { STORAGE_TABLES, type SqlExecutor } from '@orot/storage';
import {
  healthPeriodDeletionGuards,
  replaceHealthPeriodTrigger,
} from './healthPeriodDependencies';
import { periodRowReferences } from './conversationPeriodRemoval';
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
  for (const [table, guard] of Object.entries(healthPeriodDeletionGuards())) {
    const kind = Object.entries(STORAGE_TABLES).find(
      ([, entry]) => entry.table === table,
    )![0];
    for (const marker of [
      'source_deletion_tombstones',
      'agent_memory_removed_sources',
    ]) {
      const condition = `EXISTS (SELECT 1 FROM ${table} h WHERE ${periodRowReferences('NEW.source_id', marker, kind)} AND (${guard.replaceAll('OLD.', 'h.')}))`;
      await replaceHealthPeriodTrigger(
        tx,
        `CREATE TRIGGER ${prefix}_${table}_${marker} AFTER INSERT ON ${marker} BEGIN ${remove(condition)} END`,
      );
    }
  }
}
