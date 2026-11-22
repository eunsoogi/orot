import {
  createManualHistoryRepository,
  type SqlDatabase,
  type SqlExecutor,
} from '@orot/storage';
import {
  archivedHealthSummaryOwner,
  readArchivedHealthSummaryPresentation,
} from './archivedHealthSummaryPresentation';
import { decodeConversationArtifact } from './conversationArtifactCodec';
import { assertConversationArtifactCurrent } from './conversationArtifactFreshness';
import { decodeSavedSymptomSummary } from './symptomSummaryStorageCodec';
import { assertRetainedEvidenceCurrent } from './retainedEvidenceFreshness';
import { withWritePeriodCalculations } from './writePeriodCalculationScope';
import { RetainedSourceInvalidError } from '../aiFeatures/integration/retainedSourceError';
import { fingerprint } from '../aiFeatures/integration/evidenceUtils';

type Lease = { readonly id: string; readonly version: number };
type BookmarkInput = {
  readonly artifactId: string;
  readonly lease: Lease;
  readonly current: () => boolean;
  readonly savedAt?: string;
};

export async function setupSavedHealthSummaryReferences(tx: SqlExecutor) {
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS saved_health_summary_refs (summary_id TEXT PRIMARY KEY NOT NULL, artifact_id TEXT UNIQUE NOT NULL, revision TEXT NOT NULL, saved_at TEXT NOT NULL)',
  );
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS saved_health_summary_reply_removed
    AFTER DELETE ON conversation_artifacts BEGIN
      DELETE FROM saved_health_summary_refs WHERE artifact_id = OLD.id;
    END`);
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS saved_health_summary_original_removed
    AFTER DELETE ON symptom_summary_runs BEGIN
      DELETE FROM saved_health_summary_refs WHERE summary_id = OLD.id;
    END`);
}

const visible = `FROM saved_health_summary_refs b
  JOIN conversation_artifacts a ON a.id = b.artifact_id
  JOIN symptom_summary_runs run ON run.id = b.summary_id
  JOIN conversation_artifact_sessions s ON s.id = a.session_id
  JOIN conversation_artifact_generation g ON g.singleton = 1 AND g.generation = s.generation
  WHERE s.hidden = 0`;

/** Keep a reference and exact current revision, never report prose or model memory. */
export function createSavedHealthSummaryReferences(
  database: SqlDatabase,
  ensure: () => Promise<void>,
) {
  const history = createManualHistoryRepository(database);
  const resolve = async (
    tx: SqlExecutor,
    raw: unknown,
    id: string,
    sessionId: unknown,
  ) => {
    const artifact = decodeConversationArtifact(raw);
    if (
      !artifact?.healthSummary ||
      artifact.id !== id ||
      typeof sessionId !== 'string' ||
      artifact.sessionId !== sessionId ||
      artifact.status !== 'complete'
    )
      return null;
    const owner = archivedHealthSummaryOwner(id, { ...artifact });
    if (!owner) return null;
    const projection = (
      await readArchivedHealthSummaryPresentation(tx, [owner])
    ).get(id);
    if (
      !projection?.archivedSummaryRevision ||
      projection.analysis.savedSummary?.status !== 'saved' ||
      projection.analysis.savedSummary.sourceChanged
    )
      return null;
    const summaryId = owner.reference.summaryId;
    const original = decodeSavedSymptomSummary(
      (
        await tx.execute(
          'SELECT result_json FROM symptom_summary_runs WHERE id = ?',
          [summaryId],
        )
      ).rows[0]?.result_json,
    );
    if (
      !original ||
      fingerprint(original) !== projection.archivedSummaryRevision
    )
      return null;
    try {
      await withWritePeriodCalculations(tx, async validate => {
        await assertConversationArtifactCurrent(
          tx,
          database,
          artifact,
          false,
          validate,
        );
        await assertRetainedEvidenceCurrent(
          tx,
          original.sources,
          history,
          false,
          undefined,
          validate,
        );
      });
    } catch (error) {
      if (error instanceof RetainedSourceInvalidError) return null;
      throw error;
    }
    return {
      summaryId,
      revision: projection.archivedSummaryRevision,
      projection,
    };
  };
  return {
    async bookmarkHealthSummary(input: BookmarkInput): Promise<boolean> {
      if (!input.current()) return false;
      await ensure();
      let saved = false;
      await database.transaction(async tx => {
        if (!input.current()) return;
        const row = (
          await tx.execute(
            `SELECT a.result_json FROM conversation_artifacts a
            JOIN conversation_artifact_sessions s ON s.id = a.session_id
            JOIN conversation_artifact_generation g ON g.singleton = 1 AND g.generation = s.generation
            WHERE a.id = ? AND s.id = ? AND s.version = ? AND s.hidden = 0`,
            [input.artifactId, input.lease.id, input.lease.version],
          )
        ).rows[0];
        const result = await resolve(
          tx,
          row?.result_json,
          input.artifactId,
          input.lease.id,
        );
        if (!result || !input.current()) return;
        await tx.execute(
          'INSERT INTO saved_health_summary_refs VALUES (?, ?, ?, ?) ON CONFLICT(summary_id) DO NOTHING',
          [
            result.summaryId,
            input.artifactId,
            result.revision,
            input.savedAt ?? new Date().toISOString(),
          ],
        );
        const pin = (
          await tx.execute(
            `SELECT b.artifact_id, b.revision ${visible} AND b.summary_id = ?`,
            [result.summaryId],
          )
        ).rows[0];
        if (
          pin?.artifact_id !== input.artifactId ||
          pin.revision !== result.revision
        )
          return;
        // No await between the final UI-owner fence and the synchronous commit.
        if (!input.current()) throw new Error('Summary bookmark owner moved.');
        tx.commit();
        saved = true;
      });
      return saved;
    },
    async listSavedHealthSummaryReferences() {
      const schema = await database.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'saved_health_summary_refs'",
      );
      if (!schema.rows.length) return [];
      const { rows } = await database.execute(
        `SELECT b.artifact_id, b.saved_at ${visible} ORDER BY b.saved_at DESC, b.artifact_id`,
      );
      return rows.flatMap(row =>
        typeof row.artifact_id === 'string' &&
        typeof row.saved_at === 'string' &&
        Number.isFinite(Date.parse(row.saved_at))
          ? [
              {
                artifactId: row.artifact_id,
                savedAt: row.saved_at,
                reportKind: 'health_summary' as const,
              },
            ]
          : [],
      );
    },
    async readSavedHealthSummaryReference(
      artifactId: string,
      current: () => boolean,
    ) {
      if (!current()) return null;
      const schema = await database.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'saved_health_summary_refs'",
      );
      if (!schema.rows.length || !current()) return null;
      let result:
        NonNullable<Awaited<ReturnType<typeof resolve>>>['projection'] | null =
        null;
      await database.transaction(async tx => {
        if (!current()) return;
        const row = (
          await tx.execute(
            `SELECT a.result_json, a.session_id, b.summary_id, b.revision ${visible} AND a.id = ?`,
            [artifactId],
          )
        ).rows[0];
        const resolved = await resolve(
          tx,
          row?.result_json,
          artifactId,
          row?.session_id,
        );
        if (
          current() &&
          resolved &&
          resolved.summaryId === row?.summary_id &&
          resolved.revision === row?.revision
        )
          result = resolved.projection;
      });
      return current() ? result : null;
    },
  };
}
