import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import type { HealthSummaryResult } from '../ragConversation/healthSummary';

type Live = {
  readonly current: () => boolean;
  readonly confirmProtected: () => Promise<boolean>;
};
type Owner = Live & {
  readonly artifactId: string;
  readonly lease: { readonly id: string; readonly version: number };
  readonly revision: string;
};
type Original = {
  readonly summaryId: string;
  readonly revision: string;
  readonly projection: HealthSummaryResult;
};
type Resolve = (
  tx: SqlExecutor,
  raw: unknown,
  artifactId: string,
  sessionId: unknown,
) => Promise<Original | null>;

export async function setupSavedHealthSummarySections(tx: SqlExecutor) {
  await tx.execute(`CREATE TABLE IF NOT EXISTS saved_health_summary_sections (
    id TEXT PRIMARY KEY NOT NULL, artifact_id TEXT NOT NULL, summary_id TEXT NOT NULL,
    session_version INTEGER NOT NULL, revision TEXT NOT NULL, ordinal INTEGER NOT NULL,
    saved_at TEXT NOT NULL, UNIQUE(artifact_id, ordinal)
  )`);
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS saved_health_summary_section_reply_removed
    AFTER DELETE ON conversation_artifacts BEGIN
      DELETE FROM saved_health_summary_sections WHERE artifact_id = OLD.id;
    END`);
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS saved_health_summary_section_original_removed
    AFTER DELETE ON symptom_summary_runs BEGIN
      DELETE FROM saved_health_summary_sections WHERE summary_id = OLD.id;
    END`);
}

const visible = `FROM conversation_artifacts a
  JOIN conversation_artifact_sessions s ON s.id = a.session_id
  JOIN conversation_artifact_generation g ON g.singleton = 1 AND g.generation = s.generation`;
const referenced = `${visible}
  JOIN saved_health_summary_sections m ON m.artifact_id = a.id AND m.session_version = s.version
  JOIN symptom_summary_runs r ON r.id = m.summary_id
  WHERE s.hidden = 0`;

function exactSection(original: Original, ordinal: number) {
  const section =
    Number.isSafeInteger(ordinal) && ordinal >= 0
      ? original.projection.analysis.hypotheses[ordinal]
      : undefined;
  const title = section?.title;
  const summary = section?.summary;
  if (
    !section ||
    !title?.trim() ||
    title.length > 200 ||
    !summary?.trim() ||
    summary.length > 1200 ||
    section.uncertainty.length > 600 ||
    section.missingData.length > 6 ||
    section.missingData.some(text => text.length > 400)
  )
    return;
  return {
    ordinal,
    title,
    summary,
    uncertainty: section.uncertainty,
    missingData: section.missingData,
  };
}

/** Refer to an existing exact AI-generated section. Never copy its body, evidence, or
 * citations into Memory vectors, search indexes, a model turn, or an authored fact. */
export function createSavedHealthSummarySections(
  database: SqlDatabase,
  ensure: () => Promise<void>,
  resolve: Resolve,
  databaseCurrent: () => boolean = () => false,
) {
  const current = (owner: Live) => databaseCurrent() && owner.current();
  const positive = async (owner: Live) =>
    current(owner) && (await owner.confirmProtected()) && current(owner);
  const loadExact = async (tx: SqlExecutor, owner: Owner) => {
    const row = (
      await tx.execute(
        `SELECT a.result_json ${visible} WHERE a.id = ? AND s.id = ?
          AND s.version = ? AND s.hidden = 0`,
        [owner.artifactId, owner.lease.id, owner.lease.version],
      )
    ).rows[0];
    const parsed = await resolve(
      tx,
      row?.result_json,
      owner.artifactId,
      owner.lease.id,
    );
    return parsed?.revision === owner.revision ? parsed : null;
  };
  const exists = async () =>
    (
      await database.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'saved_health_summary_sections'",
      )
    ).rows.length === 1;
  return {
    async readExactHealthSummarySections(owner: Owner) {
      if (!(await positive(owner))) return [];
      let sections: NonNullable<ReturnType<typeof exactSection>>[] = [];
      await database.transaction(async tx => {
        if (!current(owner)) return;
        const original = await loadExact(tx, owner);
        if (!original || !(await positive(owner))) return;
        // An incomplete offer could silently substitute a different section.
        const all = original.projection.analysis.hypotheses.map((_, i) =>
          exactSection(original, i),
        );
        if (all.every(section => section !== undefined)) sections = all;
      });
      return current(owner) ? sections : [];
    },
    async bookmarkHealthSummarySection(
      owner: Owner,
      ordinal: number,
      id: string,
    ) {
      if (!id || !(await positive(owner))) return;
      await ensure();
      let saved: string | undefined;
      await database.transaction(async tx => {
        if (!current(owner)) return;
        const original = await loadExact(tx, owner);
        if (!original || !exactSection(original, ordinal) || !current(owner))
          return;
        await tx.execute(
          `INSERT INTO saved_health_summary_sections VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(artifact_id, ordinal) DO NOTHING`,
          [
            id,
            owner.artifactId,
            original.summaryId,
            owner.lease.version,
            original.revision,
            ordinal,
            new Date().toISOString(),
          ],
        );
        const existing = (
          await tx.execute(
            `SELECT m.id, m.revision, m.summary_id ${referenced}
            AND m.artifact_id = ? AND m.ordinal = ?`,
            [owner.artifactId, ordinal],
          )
        ).rows[0];
        if (
          typeof existing?.id !== 'string' ||
          existing.revision !== original.revision ||
          existing.summary_id !== original.summaryId ||
          !(await positive(owner))
        )
          throw new Error('The exact reviewed section is no longer available.');
        tx.commit();
        saved = existing.id;
      });
      return current(owner) ? saved : undefined;
    },
    async readBookmarkedHealthSummarySection(id: string, owner: Live) {
      if (!(await positive(owner)) || !(await exists()) || !current(owner))
        return null;
      let saved:
        | (NonNullable<ReturnType<typeof exactSection>> & {
            detail: HealthSummaryResult;
          })
        | undefined;
      await database.transaction(async tx => {
        if (!current(owner)) return;
        const row = (
          await tx.execute(
            `SELECT a.result_json, m.artifact_id, m.summary_id, m.revision,
            m.ordinal, s.id AS session_id ${referenced} AND m.id = ?`,
            [id],
          )
        ).rows[0];
        if (
          typeof row?.artifact_id !== 'string' ||
          typeof row.ordinal !== 'number'
        )
          return;
        const original = await resolve(
          tx,
          row.result_json,
          row.artifact_id,
          row.session_id,
        );
        if (
          !original ||
          original.summaryId !== row.summary_id ||
          original.revision !== row.revision ||
          !(await positive(owner))
        )
          return;
        const section = exactSection(original, row.ordinal);
        const { reference, analysis } = original.projection;
        if (section)
          saved = {
            ...section,
            detail: {
              reference,
              analysis: {
                ...analysis,
                hypotheses: [analysis.hypotheses[row.ordinal]!],
              },
            },
          };
      });
      return current(owner) ? (saved ?? null) : null;
    },
    async listSavedHealthSummarySections() {
      if (!databaseCurrent() || !(await exists())) return [];
      const { rows } = await database.execute(
        `SELECT m.id, m.saved_at ${referenced} ORDER BY m.saved_at DESC, m.id`,
      );
      return databaseCurrent()
        ? rows.flatMap(row =>
            typeof row.id === 'string' &&
            typeof row.saved_at === 'string' &&
            Number.isFinite(Date.parse(row.saved_at))
              ? [
                  {
                    artifactId: row.id,
                    savedAt: row.saved_at,
                    reportKind: 'health_summary_section' as const,
                  },
                ]
              : [],
          )
        : [];
    },
  };
}
