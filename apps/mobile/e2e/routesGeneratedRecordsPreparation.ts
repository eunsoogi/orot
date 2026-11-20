import {
  STORAGE_TABLES,
  type SqlDatabase,
  type RecordRepository,
} from '@orot/storage';

import { routesGeneratedRecordsEnabled } from './routesGeneratedRecordsSelection';

export async function prepareRoutesGeneratedRecords(
  settings: Readonly<Record<string, unknown>>,
  dependencies: {
    nativeTestControl: boolean;
    open: () => Promise<{ database: SqlDatabase; records: RecordRepository }>;
    seed: (
      database: SqlDatabase,
      records: RecordRepository,
    ) => Promise<unknown>;
  },
) {
  if (
    !routesGeneratedRecordsEnabled(settings) ||
    !dependencies.nativeTestControl ||
    typeof settings.OROT_ROUTES_FIXTURE_SESSION !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      settings.OROT_ROUTES_FIXTURE_SESSION,
    )
  ) {
    throw new Error('An owned synthetic Routes fixture is required.');
  }
  const { database, records } = await dependencies.open();
  const tables = new Set(
    (
      await database.execute(
        "SELECT name FROM sqlite_master WHERE type='table'",
      )
    ).rows.map(row => row.name),
  );
  // A fresh host-owned container is required. Reject retained data rather than
  // clearing it or overwriting a prior run, even if its IDs differ from ours.
  for (const table of [
    ...Object.values(STORAGE_TABLES).map(value => value.table),
    'symptom_summary_runs',
    'conversation_artifacts',
  ]) {
    if (
      tables.has(table) &&
      (await database.execute(`SELECT 1 AS occupied FROM ${table} LIMIT 1`))
        .rows.length
    ) {
      throw new Error('Routes fixtures require an empty owned record store.');
    }
  }
  await dependencies.seed(database, records);
}
