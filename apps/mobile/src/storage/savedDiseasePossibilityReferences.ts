import {
  createManualHistoryRepository,
  type SqlDatabase,
  type SqlExecutor,
} from '@orot/storage';
import { readCurrentRetainedSummary } from './summaryArtifactRevalidation';
import { withWritePeriodCalculations } from './writePeriodCalculationScope';
import {
  createReadOnlyPeriodValidation,
  type ReadOnlyPeriodValidation,
} from './readOnlyPeriodValidation';
import { RetainedSourceInvalidError } from '../aiFeatures/integration/retainedSourceError';

type Original = { readonly id: string; readonly revision: string };

/** A committed standalone report keeps one identity-only link, independent of conversation prose. */
export async function setupSavedDiseasePossibilityReferences(tx: SqlExecutor) {
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS saved_disease_possibility_refs (summary_id TEXT PRIMARY KEY NOT NULL, revision TEXT NOT NULL, saved_at TEXT NOT NULL)',
  );
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS saved_disease_possibility_removed
    AFTER DELETE ON symptom_summary_runs BEGIN
      DELETE FROM saved_disease_possibility_refs WHERE summary_id = OLD.id;
    END`);
}

const catalog =
  'FROM saved_disease_possibility_refs pin JOIN symptom_summary_runs r ON r.id = pin.summary_id';

export function createSavedDiseasePossibilityReferences(
  database: SqlDatabase,
  ensure: () => Promise<void>,
) {
  const history = createManualHistoryRepository(database);
  const exists = async () =>
    Boolean(
      (
        await database.execute(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'saved_disease_possibility_refs'",
        )
      ).rows.length,
    );
  const resolve = async (
    tx: SqlExecutor,
    original: Original,
    validatePeriod: ReadOnlyPeriodValidation,
  ) => {
    // The report families share a storage table. A daily run is never a possibility
    // report, even if malformed or deliberately similar to the possibility schema.
    const daily = await tx.execute(
      'SELECT run_id FROM daily_report_revisions WHERE run_id = ?',
      [original.id],
    );
    if (daily.rows.length) return null;
    const saved = await readCurrentRetainedSummary(
      tx,
      original,
      history,
      validatePeriod,
    );
    return saved?.id === original.id &&
      saved.analysis.presentation === undefined &&
      saved.analysis.hypotheses.length > 0
      ? saved
      : null;
  };
  return {
    async bookmarkDiseasePossibilities(
      original: Original & { readonly current: () => boolean },
    ) {
      if (!original.current()) return false;
      await ensure();
      let saved = false;
      try {
        await database.transaction(async tx => {
          const prepared = await withWritePeriodCalculations(
            tx,
            async validate => {
              if (
                !original.current() ||
                !(await resolve(tx, original, validate)) ||
                !original.current()
              )
                return false;
              await tx.execute(
                'INSERT INTO saved_disease_possibility_refs VALUES (?,?,?) ON CONFLICT(summary_id) DO NOTHING',
                [original.id, original.revision, new Date().toISOString()],
              );
              const pinned = await tx.execute(
                'SELECT revision FROM saved_disease_possibility_refs WHERE summary_id = ?',
                [original.id],
              );
              // Recheck the currently visible original and all retained sources
              // after preparing the link. The write scope also fences any period
              // generation transition before the synchronous commit below.
              if (
                pinned.rows[0]?.revision !== original.revision ||
                !(await resolve(tx, original, validate))
              )
                throw new RetainedSourceInvalidError(
                  'The bookmarked report changed before saving.',
                );
              return true;
            },
          );
          if (!prepared) return;
          // No await between the final selection fence and commit.
          if (!original.current())
            throw new Error('Report bookmark owner moved.');
          tx.commit();
          saved = true;
        });
      } catch (error) {
        if (error instanceof RetainedSourceInvalidError) return false;
        throw error;
      }
      return saved;
    },
    async listSavedDiseasePossibilityReferences() {
      if (!(await exists())) return [];
      const { rows } = await database.execute(
        `SELECT pin.summary_id, pin.saved_at ${catalog} ORDER BY pin.saved_at DESC, pin.summary_id`,
      );
      return rows.flatMap(row =>
        typeof row.summary_id === 'string' &&
        typeof row.saved_at === 'string' &&
        Number.isFinite(Date.parse(row.saved_at))
          ? [
              {
                artifactId: row.summary_id,
                savedAt: row.saved_at,
                reportKind: 'disease_possibilities' as const,
              },
            ]
          : [],
      );
    },
    async readSavedDiseasePossibilitiesPin(id: string, current: () => boolean) {
      if (!current() || !(await exists()) || !current()) return null;
      const { rows } = await database.execute(
        `SELECT pin.revision ${catalog} WHERE pin.summary_id = ?`,
        [id],
      );
      const revision = rows[0]?.revision;
      return typeof revision === 'string' && current() ? revision : null;
    },
    async readSavedDiseasePossibilitiesReference(
      id: string,
      current: () => boolean,
    ) {
      if (!current() || !(await exists()) || !current()) return null;
      const result: { original: Awaited<ReturnType<typeof resolve>> } = {
        original: null,
      };
      await database.transaction(async tx => {
        if (!current()) return;
        const { rows } = await tx.execute(
          `SELECT pin.revision ${catalog} WHERE pin.summary_id = ?`,
          [id],
        );
        const revision = rows[0]?.revision;
        if (typeof revision === 'string' && current())
          result.original = await resolve(
            tx,
            { id, revision },
            createReadOnlyPeriodValidation(tx),
          );
      });
      return current() ? result.original : null;
    },
  };
}
