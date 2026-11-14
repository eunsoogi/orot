import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import { stableJson } from '../aiFeatures/integration/evidenceUtils';
import { setupConversationWorkflowResume } from './conversationWorkflowResumeSchema';
export interface ConversationResumeManifest {
  requestId: string;
  sessionId: string;
  sessionVersion: number;
  operationRunId: string;
  threadId: string;
  providerId: string;
  modelId: string;
  recipient: string;
  inputIdentity: string;
  contextIdentity: string;
  scopeIdentity: string;
  approvalIdentity: string;
  budgetIdentity: string;
  workflowVersion: string;
}
export interface ConversationResumeBoundary {
  checkpointId: string;
  phase: 'task_response' | 'evidence_research' | 'revised_response';
  pendingOperation: boolean;
  terminal: boolean;
}
export interface ConversationResumeClaim {
  requestId: string;
  checkpointId: string;
  attempt: number;
}
export type ConversationResumeEligibility =
  | 'eligible'
  | 'unavailable'
  | 'identity_changed'
  | 'missing_checkpoint'
  | 'unconfirmed_operation'
  | 'terminal'
  | 'already_claimed'
  | 'source_or_approval_invalid';

/** Storage fencing only: callers must validate graph shape, exact input/evidence revisions,
 * budget and current consent in the same transaction. This is not permission to dispatch.
 * No expired-owner takeover is allowed: its external call may still have completed.
 */
export function createConversationWorkflowResumeStorage(
  database: SqlDatabase,
  ensureRequests: () => Promise<void>,
  validate: (
    sql: SqlExecutor,
    manifest: ConversationResumeManifest,
    checkpointId: string,
  ) => Promise<boolean>,
) {
  async function ensure() {
    await ensureRequests();
    await database.transaction(setupConversationWorkflowResume);
  }
  async function live(sql: SqlExecutor, m: ConversationResumeManifest) {
    const result = await sql.execute(
      `SELECT r.status FROM conversation_requests r
      JOIN conversation_artifact_sessions s ON s.id = r.session_id
      JOIN conversation_artifact_generation g ON g.singleton = 1
      WHERE r.id = ? AND r.session_id = ? AND r.session_version = ?
      AND s.version = r.session_version AND s.hidden = 0 AND s.generation = g.generation
      AND r.status IN ('active', 'interrupted')`,
      [m.requestId, m.sessionId, m.sessionVersion],
    );
    return result.rows[0]?.status;
  }
  async function inspect(
    sql: SqlExecutor,
    m: ConversationResumeManifest,
    checkpointId: string,
  ): Promise<ConversationResumeEligibility> {
    if ((await live(sql, m)) !== 'interrupted') return 'unavailable';
    const row = (
      await sql.execute(
        'SELECT * FROM conversation_workflow_resumes WHERE request_id = ?',
        [m.requestId],
      )
    ).rows[0];
    if (!row) return 'unavailable';
    if (row.manifest !== stableJson(m)) return 'identity_changed';
    if (row.claimed !== 0) return 'already_claimed';
    if (row.checkpoint_id !== checkpointId || typeof row.boundary !== 'string')
      return 'missing_checkpoint';
    const b = JSON.parse(row.boundary) as ConversationResumeBoundary;
    if (b.pendingOperation !== false) return 'unconfirmed_operation';
    if (b.terminal !== false) return 'terminal';
    if (
      !['task_response', 'evidence_research', 'revised_response'].includes(
        b.phase,
      )
    )
      return 'missing_checkpoint';
    try {
      if (!(await validate(sql, m, checkpointId)))
        return 'source_or_approval_invalid';
    } catch {
      return 'source_or_approval_invalid';
    }
    return 'eligible';
  }
  return {
    async register(m: ConversationResumeManifest) {
      if (
        !Number.isSafeInteger(m.sessionVersion) ||
        m.sessionVersion < 0 ||
        [
          'requestId',
          'sessionId',
          'operationRunId',
          'threadId',
          'providerId',
          'modelId',
          'recipient',
          'inputIdentity',
          'contextIdentity',
          'scopeIdentity',
          'approvalIdentity',
          'budgetIdentity',
          'workflowVersion',
        ].some(key => {
          const value = m[key as keyof ConversationResumeManifest];
          return (
            typeof value !== 'string' || !value.trim() || value.length > 2000
          );
        })
      )
        throw new Error('Invalid resume manifest.');
      await ensure();
      await database.transaction(async sql => {
        if ((await live(sql, m)) !== 'active')
          throw new Error('Request unavailable.');
        const previous = (
          await sql.execute(
            'SELECT manifest FROM conversation_workflow_resumes WHERE request_id = ?',
            [m.requestId],
          )
        ).rows[0];
        if (previous && previous.manifest !== stableJson(m))
          throw new Error('Resume manifest is immutable.');
        await sql.execute(
          `INSERT OR IGNORE INTO conversation_workflow_resumes
          (request_id, manifest) VALUES (?, ?)`,
          [m.requestId, stableJson(m)],
        );
      });
    },
    /** Called only after durable graph checkpoint persistence, not on a UI tool event.
     * Original execution uses attempt 0; resumed executions must hold their exact claim.
     */
    async saveBoundary(
      m: ConversationResumeManifest,
      boundary: ConversationResumeBoundary,
      attempt: number,
    ) {
      if (
        !boundary.checkpointId ||
        !Number.isSafeInteger(attempt) ||
        attempt < 0
      )
        throw new Error('Invalid boundary.');
      await ensure();
      await database.transaction(async sql => {
        if (!(await live(sql, m))) throw new Error('Request unavailable.');
        const row = (
          await sql.execute(
            'SELECT manifest, attempt FROM conversation_workflow_resumes WHERE request_id = ?',
            [m.requestId],
          )
        ).rows[0];
        if (!row || row.manifest !== stableJson(m) || row.attempt !== attempt)
          throw new Error('Stale resume attempt.');
        await sql.execute(
          `UPDATE conversation_workflow_resumes SET checkpoint_id = ?,
          boundary = ?, claimed = 0 WHERE request_id = ? AND attempt = ?`,
          [boundary.checkpointId, stableJson(boundary), m.requestId, attempt],
        );
      });
    },
    async eligibility(m: ConversationResumeManifest, checkpointId: string) {
      await ensure();
      let result: ConversationResumeEligibility = 'unavailable';
      await database.transaction(async sql => {
        result = await inspect(sql, m, checkpointId);
      });
      return result;
    },
    /** Fence local result writes inside the same transaction. Never dispatch external work here. */
    async withClaim(
      m: ConversationResumeManifest,
      claim: ConversationResumeClaim,
      write: (sql: SqlExecutor) => Promise<void>,
    ) {
      await ensure();
      await database.transaction(async sql => {
        const row = (
          await sql.execute(
            'SELECT * FROM conversation_workflow_resumes WHERE request_id = ?',
            [m.requestId],
          )
        ).rows[0];
        if (
          !(await live(sql, m)) ||
          claim.requestId !== m.requestId ||
          !row ||
          row.manifest !== stableJson(m) ||
          row.attempt !== claim.attempt ||
          row.checkpoint_id !== claim.checkpointId ||
          row.claimed !== 1
        )
          throw new Error('Stale resume claim.');
        if (!(await validate(sql, m, claim.checkpointId)))
          throw new Error('Resume sources or approval changed.');
        await write(sql);
      });
    },
    async claim(
      m: ConversationResumeManifest,
      checkpointId: string,
      activate?: (sql: SqlExecutor) => Promise<void>,
    ) {
      await ensure();
      let claim: ConversationResumeClaim | undefined;
      await database.transaction(async sql => {
        const result = await inspect(sql, m, checkpointId);
        if (result !== 'eligible') throw new Error(`Resume blocked: ${result}`);
        await sql.execute(
          `UPDATE conversation_workflow_resumes SET attempt = attempt + 1,
          claimed = 1 WHERE request_id = ? AND claimed = 0`,
          [m.requestId],
        );
        const row = (
          await sql.execute(
            'SELECT attempt FROM conversation_workflow_resumes WHERE request_id = ?',
            [m.requestId],
          )
        ).rows[0];
        if (activate) await activate(sql);
        claim = {
          requestId: m.requestId,
          checkpointId,
          attempt: Number(row.attempt),
        };
      });
      return claim!;
    },
  };
}
