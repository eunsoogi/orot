import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import {
  createConversationPossibilityOriginalReader,
  selectConversationPossibilityOriginal,
  type ConversationPossibilityOriginalInput,
} from './readConversationPossibilityOriginal';
import { withWritePeriodCalculations } from './writePeriodCalculationScope';

const table = 'saved_conversation_possibility_refs';

async function setup(tx: SqlExecutor) {
  await tx.execute(`CREATE TABLE IF NOT EXISTS ${table} (
    artifact_id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL,
    session_version INTEGER NOT NULL, created_at TEXT NOT NULL, saved_at TEXT NOT NULL
  )`);
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS saved_conversation_possibility_removed
    AFTER DELETE ON conversation_artifacts BEGIN
      DELETE FROM ${table} WHERE artifact_id=OLD.id;
    END`);
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS saved_conversation_possibility_replaced
    AFTER UPDATE OF result_json ON conversation_artifacts
    WHEN NEW.result_json IS NOT OLD.result_json BEGIN
      DELETE FROM ${table} WHERE artifact_id=OLD.id;
    END`);
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS saved_conversation_possibility_tombstone
    AFTER INSERT ON conversation_deleted_artifacts BEGIN
      DELETE FROM ${table} WHERE artifact_id=NEW.id;
    END`);
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS saved_conversation_possibility_invalid_parent
    AFTER INSERT ON conversation_invalid_parents BEGIN
      DELETE FROM ${table} WHERE artifact_id=NEW.id;
    END`);
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS saved_conversation_possibility_session_removed
    AFTER DELETE ON conversation_artifact_sessions BEGIN
      DELETE FROM ${table} WHERE session_id=OLD.id;
    END`);
}

/** Identity-only links to exact Conversation originals, never standalone summaries. */
export function createSavedConversationPossibilityReference(
  database: SqlDatabase,
  ensure: () => Promise<void>,
  isCurrentDatabase: (owner: SqlDatabase) => boolean = () => false,
) {
  const reopen = createConversationPossibilityOriginalReader(
    database,
    isCurrentDatabase,
    async (tx, input) => {
      const { artifactId, createdAt, lease } = input;
      const pin = await tx.execute(
        `SELECT 1 FROM ${table} WHERE artifact_id=? AND session_id=? AND session_version=? AND created_at=?`,
        [artifactId, lease.id, lease.version, createdAt],
      );
      return pin.rows.length === 1;
    },
  );
  return {
    async bookmarkConversationPossibility(
      input: Omit<ConversationPossibilityOriginalInput, 'createdAt'> & {
        readonly createdAt?: string;
      },
    ) {
      const { artifactId, createdAt, lease, confirmProtected } = input;
      const { id, version } = lease;

      const current = () => input.current() && isCurrentDatabase(database);
      let saved = false;
      try {
        if (!current() || (await confirmProtected()) !== true || !current())
          return false;
        await ensure();
        await database.transaction(async tx => {
          const accepted = await withWritePeriodCalculations(
            tx,
            async validate => {
              const observedAt =
                createdAt ??
                (
                  await tx.execute(
                    'SELECT created_at FROM conversation_artifacts WHERE id=? AND session_id=?',
                    [artifactId, id],
                  )
                ).rows[0]?.created_at;
              if (typeof observedAt !== 'string') return false;
              const stamp = {
                artifactId,
                createdAt: observedAt,
                lease: { id, version },
              };
              const first = await selectConversationPossibilityOriginal(
                tx,
                database,
                stamp,
                current,
                validate,
              );
              if (!first) return false;
              // Lazily initialize only after the exact source and native owner are proved.
              await setup(tx);
              await tx.execute(
                `INSERT INTO ${table} VALUES (?,?,?,?,?) ON CONFLICT(artifact_id) DO NOTHING`,
                [artifactId, id, version, observedAt, new Date().toISOString()],
              );
              const pin = (
                await tx.execute(
                  `SELECT 1 FROM ${table} WHERE artifact_id=? AND session_id=? AND session_version=? AND created_at=?`,
                  [artifactId, id, version, observedAt],
                )
              ).rows.length;
              // An awaited native probe can outlive the initial SQL proof.
              if (
                pin !== 1 ||
                (await confirmProtected()) !== true ||
                !current()
              )
                throw new Error(
                  'The generated report bookmark lost its owner.',
                );
              const last = await selectConversationPossibilityOriginal(
                tx,
                database,
                stamp,
                current,
                validate,
              );
              if (!last || last.raw !== first.raw)
                throw new Error(
                  'The generated report bookmark source changed.',
                );
              return true;
            },
          );
          if (!accepted) return;
          if (!current())
            throw new Error('The generated report bookmark lost its owner.');
          tx.commit();
          saved = true;
        });
      } catch {
        return saved;
      }
      return saved;
    },
    async listBookmarkedConversationPossibilities() {
      if (!isCurrentDatabase(database)) return [];
      const exists = await database.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        [table],
      );
      if (!exists.rows.length || !isCurrentDatabase(database)) return [];
      const { rows } =
        await database.execute(`SELECT p.artifact_id, p.saved_at FROM ${table} p
        JOIN conversation_artifacts a ON a.id=p.artifact_id AND a.session_id=p.session_id AND a.created_at=p.created_at
        JOIN conversation_artifact_sessions s ON s.id=p.session_id AND s.version=p.session_version AND s.hidden=0
        JOIN conversation_artifact_generation g ON g.singleton=1 AND g.generation=s.generation
        WHERE NOT EXISTS (SELECT 1 FROM conversation_artifact_removed_sessions x WHERE x.id=s.id)
          AND NOT EXISTS (SELECT 1 FROM conversation_deleted_artifacts x WHERE x.id=a.id)
          AND NOT EXISTS (SELECT 1 FROM conversation_invalid_parents x WHERE x.id=a.id)`);
      return isCurrentDatabase(database)
        ? rows.flatMap(row =>
            typeof row.artifact_id === 'string' &&
            typeof row.saved_at === 'string' &&
            Number.isFinite(Date.parse(row.saved_at))
              ? [
                  {
                    artifactId: row.artifact_id,
                    savedAt: row.saved_at,
                    reportKind: 'conversation_disease_possibilities' as const,
                  },
                ]
              : [],
          )
        : [];
    },
    async readBookmarkedConversationPossibility(
      artifactId: string,
      input: Pick<
        ConversationPossibilityOriginalInput,
        'current' | 'confirmProtected'
      >,
    ) {
      const current = () => input.current() && isCurrentDatabase(database);
      try {
        if (
          !current() ||
          (await input.confirmProtected()) !== true ||
          !current()
        )
          return null;
        const exists = await database.execute(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
          [table],
        );
        if (!current() || !exists.rows.length) return null;
        const row = (
          await database.execute(
            `SELECT session_id, session_version, created_at FROM ${table} WHERE artifact_id=?`,
            [artifactId],
          )
        ).rows[0];
        if (
          !row ||
          typeof row.session_id !== 'string' ||
          typeof row.session_version !== 'number' ||
          typeof row.created_at !== 'string' ||
          !current()
        )
          return null;
        return await reopen({
          artifactId,
          lease: { id: row.session_id, version: row.session_version },
          createdAt: row.created_at,
          ...input,
        });
      } catch {
        return null;
      }
    },
  };
}
