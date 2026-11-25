import {
  periodRecordingIndex,
  periodRecordKinds,
  periodRemovalIndexDefinitions,
  type SqlExecutor,
} from '@orot/storage';

export {
  fallbackProvenance,
  periodRecordingIndex,
  periodRecordKinds,
  periodRemovalIndexDefinitions,
  singletonProvenance,
  singletonProvenanceValue,
} from '@orot/storage';

/** SQLite maintains these non-authoritative indexes on every mutation; reopening
 * an old database installs them before queries use them. No lineage copies/cache. */
export async function ensurePeriodRemovalIndexes(tx: SqlExecutor) {
  // Restored databases may need their non-authoritative indexes rebuilt. Use
  // the same recording index as the main storage migration before INDEXED BY.
  await tx.execute(
    periodRecordingIndex.sql.replace(
      'CREATE INDEX ',
      'CREATE INDEX IF NOT EXISTS ',
    ),
  );
  for (const table of Object.keys(periodRecordKinds))
    for (const index of periodRemovalIndexDefinitions(table))
      await tx.execute(
        index.sql.replace('CREATE INDEX ', 'CREATE INDEX IF NOT EXISTS '),
      );
}
