import type {
  WorkflowOperationJournal,
  WorkflowOperationIdentity,
  WorkflowOperationRecord,
} from '@orot/agent-runtime';
import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import { stableJson } from '../aiFeatures/integration/evidenceUtils';
import type { ConversationContinuationIdentity } from './conversationWorkflowContinuationIdentity';
import { preparedConversationOperation } from './conversationPreparedOperation';
import { setupConversationOperationJournal } from './conversationOperationJournalSchema';

/** One live request/run owner; grants are deliberately not cached. A pending intent never replays. */
export async function createConversationOperationJournal(
  database: SqlDatabase,
  owner: ConversationContinuationIdentity & { operationRunId: string },
  validate: (identity: WorkflowOperationIdentity) => Promise<boolean>,
): Promise<WorkflowOperationJournal> {
  await setupConversationOperationJournal(database);
  const keys = (identity: WorkflowOperationIdentity) => [
    owner.requestId,
    owner.operationRunId,
    identity.operationId,
  ];
  async function live(sql: SqlExecutor, epoch: number) {
    if (
      (
        await sql.execute(
          'SELECT value FROM conversation_journal_epoch WHERE id = 1',
        )
      ).rows[0]?.value !== epoch
    )
      return false;
    const ownerRow = (
      await sql.execute(
        `SELECT r.id FROM conversation_requests r
      JOIN conversation_workflow_resumes w ON w.request_id = r.id
      JOIN conversation_artifact_sessions s ON s.id = r.session_id
      JOIN conversation_artifact_generation g ON g.singleton = 1
      WHERE r.id = ? AND r.session_id = ? AND r.session_version = ?
      AND r.status = 'active' AND s.hidden = 0 AND s.version = r.session_version
      AND s.generation = g.generation AND json_extract(w.manifest, '$.operationRunId') = ?`,
        [
          owner.requestId,
          owner.sessionId,
          owner.sessionVersion,
          owner.operationRunId,
        ],
      )
    ).rows[0];
    return !!ownerRow;
  }
  async function valid(identity: WorkflowOperationIdentity) {
    // Lazy source tables may have appeared since this request opened.
    await setupConversationOperationJournal(database);
    if (
      !identity.operationId ||
      identity.operationId.length > 300 ||
      typeof identity.input !== 'string' ||
      identity.input.length > 2_000_000 ||
      !Array.isArray(identity.evidenceReferences)
    )
      return undefined;
    const epoch = Number(
      (
        await database.execute(
          'SELECT value FROM conversation_journal_epoch WHERE id = 1',
        )
      ).rows[0]?.value,
    );
    try {
      return (await validate(identity)) ? epoch : undefined;
    } catch {
      return undefined;
    }
  }
  async function row(sql: SqlExecutor, identity: WorkflowOperationIdentity) {
    return (
      await sql.execute(
        `SELECT * FROM conversation_operation_journal
      WHERE request_id = ? AND run_id = ? AND operation_id = ?`,
        keys(identity),
      )
    ).rows[0];
  }
  const matches = (
    value: NonNullable<Awaited<ReturnType<typeof row>>>,
    identity: WorkflowOperationIdentity,
  ) =>
    value.input === identity.input &&
    value.refs === stableJson(identity.evidenceReferences);
  return {
    loadPrepared: preparedConversationOperation({ database, live, row, valid }),
    async loadOrCreate(identity) {
      const epoch = await valid(identity);
      if (epoch === undefined) return { status: 'invalidated' };
      let result: WorkflowOperationRecord = { status: 'invalidated' };
      await database.transaction(async sql => {
        if (!(await live(sql, epoch))) return;
        const previous = await row(sql, identity);
        if (!previous) {
          await sql.execute(
            `INSERT INTO conversation_operation_journal
            (request_id, run_id, operation_id, input, refs, status, revision)
            VALUES (?, ?, ?, ?, ?, 'ready', 0)`,
            [
              ...keys(identity),
              identity.input,
              stableJson(identity.evidenceReferences),
            ],
          );
          result = { status: 'ready', revision: 0 };
        } else if (!matches(previous, identity)) {
          await sql.execute(
            "UPDATE conversation_operation_journal SET status = 'invalidated', input = NULL, refs = NULL, result = NULL, claim = NULL WHERE request_id = ? AND run_id = ? AND operation_id = ?",
            keys(identity),
          );
        } else {
          if (previous.status === 'ready')
            result = { status: 'ready', revision: Number(previous.revision) };
          if (previous.status === 'pending') result = { status: 'pending' };
          if (
            previous.status === 'completed' &&
            typeof previous.result === 'string'
          )
            result = { status: 'completed', result: previous.result };
        }
      });
      return result;
    },
    async begin(identity) {
      const epoch = await valid(identity);
      if (epoch === undefined) return { status: 'blocked' };
      let result: Awaited<ReturnType<WorkflowOperationJournal['begin']>> = {
        status: 'blocked',
      };
      await database.transaction(async sql => {
        if (!(await live(sql, epoch))) return;
        const previous = await row(sql, identity);
        if (
          !previous ||
          !matches(previous, identity) ||
          previous.status !== 'ready' ||
          previous.revision !== identity.revision
        )
          return;
        const claim = `${owner.operationRunId}:${identity.operationId}:${identity.revision + 1}`;
        await sql.execute(
          `UPDATE conversation_operation_journal SET status = 'pending', revision = revision + 1, claim = ?
          WHERE request_id = ? AND run_id = ? AND operation_id = ? AND status = 'ready' AND revision = ?`,
          [claim, ...keys(identity), identity.revision],
        );
        result = { status: 'claimed', claim };
      });
      return result;
    },
    async complete(identity) {
      if (
        typeof identity.result !== 'string' ||
        identity.result.length > 2_000_000
      )
        return false;
      const epoch = await valid(identity);
      if (epoch === undefined) return false;
      let completed = false;
      await database.transaction(async sql => {
        if (!(await live(sql, epoch))) return;
        const previous = await row(sql, identity);
        if (
          !previous ||
          !matches(previous, identity) ||
          previous.status !== 'pending' ||
          previous.claim !== identity.claim
        )
          return;
        await sql.execute(
          `UPDATE conversation_operation_journal SET status = 'completed', result = ?
          WHERE request_id = ? AND run_id = ? AND operation_id = ? AND claim = ? AND status = 'pending'`,
          [identity.result, ...keys(identity), identity.claim],
        );
        completed = true;
      });
      return completed;
    },
  };
}
