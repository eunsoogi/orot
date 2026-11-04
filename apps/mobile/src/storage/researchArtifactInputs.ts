import {
  createManualHistoryRepository,
  localQueryTimestampKey,
  type SqlDatabase,
  type SqlExecutor,
} from '@orot/storage';
import {
  isPeriodSummarySource,
  type SavedSummarySource,
} from '../diseaseHypotheses/savedSummaries';
import { assertRetainedEvidenceCurrent } from './retainedEvidenceFreshness';
import { setupResearchInputGuards } from './researchInputGuards';
import { readResearchArtifact } from './researchArtifactCodec';
import { decodeResearchArtifact } from './researchArtifactCodec';
import { RetainedSourceInvalidError } from '../aiFeatures/integration/retainedSourceError';

export async function researchGeneration(tx: SqlExecutor): Promise<number> {
  const result = await tx.execute(
    'SELECT generation FROM research_artifact_generation WHERE singleton = 1',
  );
  const value = result.rows[0]?.generation;
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw new Error('Research retention generation is unavailable.');
  return value;
}

/** Removing a snapshot runs its dependency guards in the same transaction. */
export async function removeResearchArtifact(
  database: SqlDatabase,
  ensure: () => Promise<void>,
  id: number,
) {
  if (!Number.isSafeInteger(id) || id < 1)
    throw new Error('Invalid research identity.');
  await ensure();
  await database.transaction(async tx => {
    await tx.execute('DELETE FROM research_artifacts WHERE id = ?', [id]);
  });
}

/** Rebuild the lexical projection from validated snapshots without changing their revisions. */
export async function rebuildResearchSearch(
  tx: SqlExecutor,
  database: SqlDatabase,
) {
  // Rebuild edges before removing stale rows so descendant cleanup can traverse the new projection.
  await tx.execute('DELETE FROM research_artifact_sources');
  await tx.execute('DELETE FROM research_artifact_periods');
  const stale: number[] = [];
  let cursor = 0;
  for (;;) {
    const result = await tx.execute(
      'SELECT id, snapshot_json FROM research_artifacts WHERE id > ? ORDER BY id LIMIT 100',
      [cursor],
    );
    if (!result.rows.length) break;
    for (const row of result.rows) {
      if (typeof row.id !== 'number' || !Number.isSafeInteger(row.id))
        throw new Error('Invalid research identity.');
      const item = decodeResearchArtifact(row.id, row.snapshot_json);
      let current = item;
      if (item) {
        try {
          await appendResearchInputs(tx, database, row.id, item.inputSources);
        } catch (error) {
          if (!(error instanceof RetainedSourceInvalidError)) throw error;
          stale.push(row.id);
          current = null;
        }
      }
      const text = current
        ? JSON.stringify({
            source: current.source,
            generatedText: current.generatedText,
          })
            .normalize('NFKC')
            .toLowerCase()
        : '';
      await tx.execute(
        'UPDATE research_artifacts SET search_text = ? WHERE id = ?',
        [text, row.id],
      );
      cursor = row.id;
    }
  }
  for (const id of stale)
    await tx.execute('DELETE FROM research_artifacts WHERE id = ?', [id]);
}

/** A detail is unavailable if any stored input has changed or disappeared. */
export async function readCurrentResearch(
  tx: SqlExecutor,
  database: SqlDatabase,
  id: string,
) {
  const item = await readResearchArtifact(tx, id);
  if (!item) return null;
  try {
    await assertRetainedEvidenceCurrent(
      tx,
      item.inputSources,
      createManualHistoryRepository(database),
      false,
    );
    return item;
  } catch {
    return null;
  }
}

/** Dependency rows are a rebuildable projection; the encrypted snapshot is authoritative. */
export async function setupResearchInputs(tx: SqlExecutor) {
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS research_artifact_sources (artifact_id INTEGER NOT NULL, record_kind TEXT NOT NULL, record_id TEXT NOT NULL, PRIMARY KEY (artifact_id, record_kind, record_id))',
  );
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS research_artifact_periods (artifact_id INTEGER NOT NULL, topic TEXT NOT NULL, from_key TEXT NOT NULL, to_key TEXT NOT NULL, PRIMARY KEY (artifact_id, topic, from_key, to_key))',
  );
  await tx.execute(
    'CREATE INDEX IF NOT EXISTS research_artifact_source_lookup ON research_artifact_sources (record_kind, record_id)',
  );
  await tx.execute(
    'CREATE INDEX IF NOT EXISTS research_artifact_source_id ON research_artifact_sources (record_id)',
  );
  await setupResearchInputGuards(tx);
}

/** Bind all admitted inputs and validate them in the same transaction as the research write. */
export async function appendResearchInputs(
  tx: SqlExecutor,
  database: SqlDatabase,
  id: number,
  sources: readonly SavedSummarySource[],
) {
  if (!sources.length) return;
  await assertRetainedEvidenceCurrent(
    tx,
    sources,
    createManualHistoryRepository(database),
  );
  for (const source of sources) {
    if (isPeriodSummarySource(source)) {
      await tx.execute(
        'INSERT OR IGNORE INTO research_artifact_periods VALUES (?, ?, ?, ?)',
        [
          id,
          source.scope.topic,
          localQueryTimestampKey(source.scope.window.fromInclusive),
          localQueryTimestampKey(source.scope.window.toExclusive),
        ],
      );
    } else if ('kind' in source) {
      await tx.execute(
        'INSERT OR IGNORE INTO research_artifact_sources VALUES (?, ?, ?)',
        [id, source.kind, source.id],
      );
    } else {
      for (const sourceId of [
        source.reference.sourceId,
        source.reference.evidenceId,
      ])
        await tx.execute(
          'INSERT OR IGNORE INTO research_artifact_sources VALUES (?, ?, ?)',
          [id, 'source_identity', sourceId],
        );
      for (const record of source.records)
        await tx.execute(
          'INSERT OR IGNORE INTO research_artifact_sources VALUES (?, ?, ?)',
          [id, record.kind, record.id],
        );
    }
  }
}
