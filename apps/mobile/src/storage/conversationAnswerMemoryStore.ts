import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import { decodeConversationArtifact } from './conversationArtifactCodec';
import { assertConversationArtifactCurrent } from './conversationArtifactFreshness';
import { withWritePeriodCalculations } from './writePeriodCalculationScope';
import {
  type AnswerMemoryBookmarkDisposition,
  type AnswerMemoryTerminalOperation,
  confirmTerminalAnswerBookmark,
  sameAnswerMemoryTerminalOperation,
  validAnswerMemoryTerminalOperation,
  writeLegacyAnswerBookmark,
  writeTerminalAnswerBookmark,
} from './conversationAnswerMemoryTerminalReceipt';

type Owner = { readonly id: string; readonly version: number };
type Source = { readonly id: string; readonly owner: Owner };
type Request = Source & {
  readonly currentRequestId: string;
  readonly current: () => boolean;
};

/** Keep only an identity link; a model response never becomes a user fact. */
export async function setupConversationAnswerMemory(tx: SqlExecutor) {
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS saved_conversation_answer_refs (artifact_id TEXT PRIMARY KEY NOT NULL, saved_at TEXT NOT NULL)',
  );
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS saved_conversation_answer_removed
    AFTER DELETE ON conversation_artifacts BEGIN
      DELETE FROM saved_conversation_answer_refs WHERE artifact_id = OLD.id;
    END`);
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS saved_conversation_answer_changed
    AFTER UPDATE OF result_json ON conversation_artifacts
    WHEN NEW.result_json IS NOT OLD.result_json BEGIN
      DELETE FROM saved_conversation_answer_refs WHERE artifact_id = OLD.id;
    END`);
}

const activeCompletedAnswer = `SELECT a.result_json AS raw
  FROM conversation_completions c
  JOIN conversation_artifacts a ON a.id = c.message_id AND a.session_id = c.session_id
  JOIN conversation_requests r ON r.id = c.request_id AND r.session_id = c.session_id
  JOIN conversation_artifact_sessions s ON s.id = r.session_id AND s.version = r.session_version
  JOIN conversation_artifact_generation g ON g.singleton=1 AND g.generation=s.generation
  WHERE c.request_id = ? AND c.message_id = c.request_id
    AND c.session_id = ? AND s.version = ? AND s.hidden = 0
    AND r.status = 'completed' AND r.input_json IS NULL AND r.interruption_reason IS NULL
    AND NOT EXISTS (SELECT 1 FROM conversation_deleted_artifacts WHERE id=a.id)
    AND NOT EXISTS (SELECT 1 FROM conversation_artifact_removed_sessions WHERE id=s.id)`;

function readOriginal(tx: SqlExecutor, source: Source) {
  return tx.execute(activeCompletedAnswer, [
    source.id,
    source.owner.id,
    source.owner.version,
  ]);
}

async function activeWriteRequest(tx: SqlExecutor, input: Request) {
  return (
    input.id !== input.currentRequestId &&
    Boolean(
      (
        await tx.execute(
          `SELECT 1 FROM conversation_requests
           WHERE id=? AND session_id=? AND session_version=? AND status='active'
             AND input_json IS NULL AND interruption_reason IS NULL`,
          [input.currentRequestId, input.owner.id, input.owner.version],
        )
      ).rows.length,
    )
  );
}

export function createConversationAnswerMemory(
  database: SqlDatabase,
  ensure: () => Promise<void>,
) {
  const bookmarkExists = async () =>
    Boolean(
      (
        await database.execute(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='saved_conversation_answer_refs'",
        )
      ).rows.length,
    );
  const catalog = `FROM saved_conversation_answer_refs b
    JOIN conversation_artifacts a ON a.id=b.artifact_id
    JOIN conversation_artifact_sessions s ON s.id=a.session_id AND s.hidden=0
    JOIN conversation_artifact_generation g ON g.singleton=1 AND g.generation=s.generation
    JOIN conversation_completions c ON c.message_id=b.artifact_id AND c.request_id=c.message_id AND c.session_id=s.id
    JOIN conversation_requests r ON r.id=c.request_id AND r.session_id=s.id AND r.session_version=s.version
    WHERE r.status='completed' AND r.input_json IS NULL AND r.interruption_reason IS NULL
      AND NOT EXISTS (SELECT 1 FROM conversation_deleted_artifacts WHERE id=a.id)
      AND NOT EXISTS (SELECT 1 FROM conversation_artifact_removed_sessions WHERE id=s.id)`;
  async function prepareAnswerMemory(
    input: Request,
    operation?: AnswerMemoryTerminalOperation,
  ) {
    if (
      !input.current() ||
      (operation && !validAnswerMemoryTerminalOperation(operation))
    )
      return;
    const terminal = operation ? { ...operation } : undefined;
    if (terminal) input = { ...input, owner: { ...input.owner } };
    await ensure();
    let captured: string | undefined;
    let preview: string | undefined;
    const admit = async (tx: SqlExecutor, expected?: string) =>
      withWritePeriodCalculations(tx, async validate => {
        if (!input.current() || !(await activeWriteRequest(tx, input))) return;
        const raw = (await readOriginal(tx, input)).rows[0]?.raw;
        const artifact = decodeConversationArtifact(raw);
        if (
          typeof raw !== 'string' ||
          (expected !== undefined && raw !== expected) ||
          artifact?.id !== input.id ||
          artifact.sessionId !== input.owner.id ||
          artifact.status !== 'complete' ||
          !artifact.answer.trim() ||
          artifact.entryIntent !== undefined ||
          artifact.dailyReport ||
          artifact.healthSummary ||
          artifact.visitQuestions ||
          artifact.treatmentContext ||
          artifact.submittedInput
        )
          return;
        await assertConversationArtifactCurrent(
          tx,
          database,
          artifact,
          false,
          validate,
        );
        return input.current() ? { raw, answer: artifact.answer } : undefined;
      });
    await database.transaction(async tx => {
      const source = await admit(tx);
      captured = source?.raw;
      preview = source?.answer;
    });
    if (!captured || !preview || !input.current()) return;
    const expected = captured;
    let consumed = false;
    async function commit(supplied?: AnswerMemoryTerminalOperation) {
      if (
        consumed ||
        !input.current() ||
        (terminal
          ? !supplied || !sameAnswerMemoryTerminalOperation(terminal, supplied)
          : supplied)
      )
        return;
      consumed = true;
      let committed: AnswerMemoryBookmarkDisposition | undefined;
      await database
        .transaction(async tx => {
          if (!(await admit(tx, expected))) return;
          await setupConversationAnswerMemory(tx);
          const disposition = terminal
            ? await writeTerminalAnswerBookmark(tx, input, terminal)
            : await writeLegacyAnswerBookmark(tx, input.id);
          if (!disposition) return;
          if (!(await admit(tx, expected)) || !input.current())
            throw new Error('The original answer or request changed.');
          tx.commit();
          committed = disposition;
        })
        .catch(error => {
          if (!committed) throw error;
        });
      return committed;
    }
    return {
      preview,
      commit: async (supplied?: AnswerMemoryTerminalOperation) =>
        (await commit(supplied)) === 'saved',
      commitTerminal: (supplied: AnswerMemoryTerminalOperation) =>
        terminal ? commit(supplied) : Promise.resolve(undefined),
      confirmTerminalCommit: (op: AnswerMemoryTerminalOperation) =>
        confirmTerminalAnswerBookmark(database, input, terminal, op, tx =>
          admit(tx, expected),
        ),
    };
  }
  return {
    prepareAnswerMemory,
    /** Catalog only returns identity/time. Read the original only after selection. */
    async listSavedConversationAnswers() {
      if (!(await bookmarkExists())) return [];
      const { rows } = await database.execute(
        `SELECT b.artifact_id, b.saved_at ${catalog} ORDER BY b.saved_at DESC, b.artifact_id`,
      );
      return rows.flatMap(row =>
        typeof row.artifact_id === 'string' &&
        typeof row.saved_at === 'string' &&
        Number.isFinite(Date.parse(row.saved_at))
          ? [{ artifactId: row.artifact_id, savedAt: row.saved_at }]
          : [],
      );
    },
    async readSavedConversationAnswer(
      artifactId: string,
      current: () => boolean,
    ) {
      if (!current() || !(await bookmarkExists())) return null;
      let answer: string | null = null;
      await database.transaction(async tx => {
        if (!current()) return;
        const row = (
          await tx.execute(
            `SELECT a.result_json, a.session_id ${catalog} AND a.id=?`,
            [artifactId],
          )
        ).rows[0];
        const artifact = decodeConversationArtifact(row?.result_json);
        if (
          !artifact ||
          artifact.id !== artifactId ||
          artifact.sessionId !== row?.session_id ||
          artifact.status !== 'complete' ||
          artifact.entryIntent !== undefined ||
          artifact.dailyReport ||
          artifact.healthSummary ||
          artifact.visitQuestions ||
          artifact.treatmentContext ||
          artifact.submittedInput
        )
          return;
        await withWritePeriodCalculations(tx, validate =>
          assertConversationArtifactCurrent(
            tx,
            database,
            artifact,
            false,
            validate,
          ),
        );
        if (current()) answer = artifact.answer;
      });
      return current() ? answer : null;
    },
  };
}
