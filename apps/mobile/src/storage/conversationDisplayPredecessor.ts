import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import {
  acquireIndependentReadEpoch,
  awaitIndependentReadSettlement,
} from './protectedReadEpoch';
import { captureIndependentReadRevision } from './protectedReadRevision';

export type ConversationDisplayLease = Readonly<{
  id: string;
  version: number;
  generation: number;
}>;

/** Only a model rollover may call this inside the active-pointer transaction.
 * The replaced pointer identifies the old owner; activity order is not lineage. */
export async function recordConversationDisplayPredecessor(
  tx: SqlExecutor,
  active: ConversationDisplayLease,
) {
  await tx.execute(`CREATE TABLE IF NOT EXISTS conversation_display_predecessor (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    active_id TEXT NOT NULL, active_version INTEGER NOT NULL,
    predecessor_id TEXT NOT NULL, predecessor_version INTEGER NOT NULL,
    generation INTEGER NOT NULL
  )`);
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS conversation_display_predecessor_clear
    AFTER UPDATE OF generation ON conversation_artifact_generation
    WHEN OLD.generation IS NOT NEW.generation BEGIN
      DELETE FROM conversation_display_predecessor;
    END`);
  // An undo must not revive an already invalidated display link.
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS conversation_display_predecessor_stale_session
    AFTER UPDATE OF hidden, version, generation ON conversation_artifact_sessions
    WHEN OLD.hidden IS NOT NEW.hidden OR OLD.version IS NOT NEW.version OR OLD.generation IS NOT NEW.generation BEGIN
      DELETE FROM conversation_display_predecessor WHERE active_id = OLD.id OR predecessor_id = OLD.id;
    END`);
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS conversation_display_predecessor_removed_session
    AFTER DELETE ON conversation_artifact_sessions BEGIN
      DELETE FROM conversation_display_predecessor WHERE active_id = OLD.id OR predecessor_id = OLD.id;
    END`);
  // Completed old prose is immutable while this edge owns it. Other sessions'
  // writes cannot retire it. These triggers also see indirect source deletes.
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS conversation_display_predecessor_turn_change
    AFTER UPDATE ON conversation_artifacts BEGIN
      DELETE FROM conversation_display_predecessor WHERE predecessor_id IN (OLD.session_id, NEW.session_id);
    END`);
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS conversation_display_predecessor_turn_remove
    AFTER DELETE ON conversation_artifacts BEGIN
      DELETE FROM conversation_display_predecessor WHERE predecessor_id = OLD.session_id;
    END`);
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS conversation_display_predecessor_turn_new
    AFTER INSERT ON conversation_artifacts BEGIN
      DELETE FROM conversation_display_predecessor WHERE predecessor_id = NEW.session_id;
    END`);
  await tx.execute('DELETE FROM conversation_display_predecessor');
  await tx.execute(
    `INSERT INTO conversation_display_predecessor
     SELECT 1, newer.id, newer.version, older.id, older.version, generation.generation
     FROM conversation_active_model pointer
     JOIN conversation_artifact_generation generation
       ON generation.singleton = 1 AND generation.generation = pointer.generation
     JOIN conversation_artifact_sessions older
       ON older.id = pointer.session_id AND older.generation = generation.generation
     JOIN conversation_artifact_sessions newer
       ON newer.id = ? AND newer.version = ? AND newer.generation = generation.generation
     WHERE pointer.singleton = 1 AND generation.generation = ?
       AND older.id <> newer.id AND older.hidden = 0 AND newer.hidden = 0
       AND NOT EXISTS (SELECT 1 FROM conversation_artifact_removed_sessions deleted
         WHERE deleted.id IN (older.id, newer.id))`,
    [active.id, active.version, active.generation],
  );
}

/** Identity-only local display lookup. This never reads or grants transcript
 * content; a future caller must still use the protected archive reader. */
export function createConversationDisplayPredecessorReader(
  database: SqlDatabase,
  ensure: () => Promise<void>,
  isCurrentDatabase: (owner: SqlDatabase) => boolean = () => false,
) {
  return async function readConversationDisplayPredecessor(
    active: ConversationDisplayLease,
    signal: AbortSignal,
    linkedSchemaAlreadyObserved = false,
  ): Promise<ConversationDisplayLease | null> {
    const current = () => !signal.aborted && isCurrentDatabase(database);
    if (
      !current() ||
      !active.id ||
      !Number.isSafeInteger(active.version) ||
      active.version < 0 ||
      !Number.isSafeInteger(active.generation) ||
      active.generation < 0
    )
      return null;
    let epoch: ReturnType<typeof acquireIndependentReadEpoch>;
    try {
      await ensure();
      epoch = acquireIndependentReadEpoch(database);
      if (!current() || !epoch) return null;
      if (!linkedSchemaAlreadyObserved) {
        const exists = await database.execute(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'conversation_display_predecessor'",
        );
        if (!current() || !epoch.current() || exists.rows.length !== 1)
          return null;
      }
      const { rows } = await database.execute(
        `SELECT older.id, older.version, edge.generation
         FROM conversation_display_predecessor edge
         JOIN conversation_artifact_generation generation
           ON generation.singleton = 1 AND generation.generation = edge.generation
         JOIN conversation_active_model pointer
           ON pointer.singleton = 1 AND pointer.session_id = edge.active_id
           AND pointer.generation = edge.generation
         JOIN conversation_artifact_sessions active
           ON active.id = edge.active_id AND active.version = edge.active_version
           AND active.generation = edge.generation
         JOIN conversation_artifact_sessions older
           ON older.id = edge.predecessor_id AND older.version = edge.predecessor_version
           AND older.generation = edge.generation
         WHERE edge.singleton = 1 AND active.id = ? AND active.version = ?
           AND edge.generation = ? AND older.id <> active.id
           AND active.hidden = 0 AND older.hidden = 0
           AND NOT EXISTS (SELECT 1 FROM conversation_artifact_removed_sessions deleted
             WHERE deleted.id IN (active.id, older.id))`,
        [active.id, active.version, active.generation],
      );
      const row = rows[0];
      return current() &&
        epoch.current() &&
        rows.length === 1 &&
        typeof row?.id === 'string' &&
        row.id.length > 0 &&
        typeof row.version === 'number' &&
        Number.isSafeInteger(row.version) &&
        row.version >= 0 &&
        row.generation === active.generation
        ? { id: row.id, version: row.version, generation: active.generation }
        : null;
    } catch {
      return null;
    } finally {
      epoch?.dispose();
    }
  };
}

/** Observe only the exact immutable predecessor, not arbitrary current model
 * writes. The guard is a wakeup; the committed edge decides revocation. */
export function createConversationDisplayPredecessorWatch(
  database: SqlDatabase,
  read: ReturnType<typeof createConversationDisplayPredecessorReader>,
  isCurrentDatabase: (owner: SqlDatabase) => boolean = () => false,
) {
  return (
    active: ConversationDisplayLease,
    older: ConversationDisplayLease,
    signal: AbortSignal,
    retire: () => void,
  ) => {
    let stopped = false;
    let stopGuard: (() => void) | undefined;
    const stop = () => {
      stopped = true;
      stopGuard?.();
    };
    const current = () =>
      !stopped && !signal.aborted && isCurrentDatabase(database);
    const check = async () => {
      // The first callback runs before the native mutation was submitted.
      // Never keep a cancelled mount alive to continue the SQL witness.
      while (current()) {
        if (
          !(await awaitIndependentReadSettlement(database, undefined, signal))
        )
          break;
        if (!current()) break;
        const revision = captureIndependentReadRevision(database);
        if (!revision) continue;
        // The original positive lookup already observed the schema. Recheck
        // only identity metadata; do not rehydrate any text on ordinary writes.
        const candidate = await read(active, signal, true);
        if (!current()) break;
        if (!revision.current()) continue;
        if (
          candidate?.id !== older.id ||
          candidate.version !== older.version ||
          candidate.generation !== older.generation
        )
          break;
        if (arm(revision)) return;
      }
      if (!stopped && !signal.aborted) retire();
    };
    const arm = (
      revision: NonNullable<ReturnType<typeof captureIndependentReadRevision>>,
    ) => {
      if (!current()) return false;
      stopGuard = revision.watch(() => {
        stopGuard?.();
        stopGuard = undefined;
        check().catch(() => {
          if (!stopped && !signal.aborted) retire();
        });
      });
      return !!stopGuard;
    };
    const initial = captureIndependentReadRevision(database);
    return initial && arm(initial) ? { current, stop } : undefined;
  };
}
