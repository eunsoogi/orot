import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { periodRecordingIndex } from '../periodRemovalIndexes';
import {
  ensureTypedDeletionMarkers,
  markerMatchesKind,
} from '../typedDeletionMarkers';

// Compare against the exact replaced predicate, including legacy JSON value equality.
export function previous(marker: string, markerTable: string, kind: string) {
  const direct = markerMatchesKind(markerTable, marker, `'${kind}'`);
  return `((h.id = ${marker} AND ${direct}) OR EXISTS
    (SELECT 1 FROM json_each(h.payload_json, '$.provenance.sourceRecordIds') linked
     LEFT JOIN transcript_segments segment ON segment.id = linked.value OR json_extract(segment.payload_json, '$.transcriptId') = linked.value
     WHERE linked.value = ${marker} OR json_extract(segment.payload_json, '$.recordingSourceId') = ${marker}))`;
}

export const from = '2026-11-15T00:00:00.000Z';
export const to = '2026-11-16T00:00:00.000Z';

export async function fixture(table: string) {
  const { database, close } = openSqliteTestDatabase(':memory:');
  await database.execute(
    `CREATE TABLE ${table}(id TEXT PRIMARY KEY,payload_json TEXT NOT NULL,effective_at TEXT)`,
  );
  await database.execute(
    'CREATE TABLE transcript_segments(id TEXT PRIMARY KEY,payload_json TEXT NOT NULL)',
  );
  await database.execute(periodRecordingIndex.sql);
  for (const marker of [
    'source_deletion_tombstones',
    'agent_memory_removed_sources',
  ])
    await database.execute(
      `CREATE TABLE ${marker}(source_id TEXT PRIMARY KEY)`,
    );
  await ensureTypedDeletionMarkers(database);
  const put = (id: string, value: unknown, at = from) =>
    database.execute(`INSERT INTO ${table} VALUES (?,?,?)`, [
      id,
      JSON.stringify({
        concept: 'heart_rate',
        observationKind: 'measurement',
        value: { kind: 'quantity', amount: 75, unit: 'count/min' },
        provenance: { sourceRecordIds: value },
      }),
      at,
    ]);
  const segment = (
    id: string,
    recording: string | null,
    family: string | number | null,
  ) =>
    database.execute('INSERT INTO transcript_segments VALUES (?,?)', [
      id,
      JSON.stringify({ recordingSourceId: recording, transcriptId: family }),
    ]);
  return { database, close, put, segment };
}
