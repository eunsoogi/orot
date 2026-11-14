import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import { stableJson } from '../aiFeatures/integration/evidenceUtils';
import {
  coldCheckpointBinding,
  coldResumeOwner,
} from './conversationColdResumeBinding';
import { setupConversationColdResume } from './conversationColdResumeSchema';
import {
  encodeColdResume,
  type ConversationColdResumeDescriptor,
} from './conversationColdResumeDescriptor';
import {
  decodeConversationResumeBoundary,
  isSafeConversationResumePhase,
} from './conversationWorkflowResumeBoundary';
import { createConversationWorkflowResumeStorage } from './conversationWorkflowResumeStorage';
import type { ConversationContinuationIdentity } from './conversationWorkflowContinuationIdentity';

/** Storage only: opening data grants no permission. Claim requires fresh reconstruction/source checks.
 * A disappeared process never permits takeover of a claimed or uncertain external operation. */
export function createConversationColdResumeStorage(database: SqlDatabase) {
  async function matches(
    sql: SqlExecutor,
    d: ConversationColdResumeDescriptor,
    status: string,
  ) {
    const owner = await coldResumeOwner(sql, d.manifest);
    const boundary =
      typeof owner?.boundary === 'string'
        ? decodeConversationResumeBoundary(owner.boundary)
        : undefined;
    return owner &&
      owner.status === status &&
      owner.epoch === d.sourceEpoch &&
      owner.manifest === stableJson(d.manifest) &&
      owner.question === d.request &&
      (owner.input_json ?? null) === d.submittedInput &&
      owner.attempt === d.attempt &&
      owner.claimed === 0 &&
      owner.checkpoint_id === d.checkpointId &&
      boundary &&
      boundary.checkpointId === d.checkpointId &&
      boundary.pendingOperation === false &&
      boundary.terminal === false &&
      isSafeConversationResumePhase(boundary)
      ? owner
      : undefined;
  }
  async function stored(sql: SqlExecutor, requestId: string) {
    return (
      await sql.execute(
        'SELECT * FROM conversation_cold_resumes WHERE request_id = ?',
        [requestId],
      )
    ).rows[0];
  }
  async function current(
    sql: SqlExecutor,
    d: ConversationColdResumeDescriptor,
    payload: string,
  ) {
    const owner = await matches(sql, d, 'interrupted');
    const row = await stored(sql, d.manifest.requestId);
    const checkpoint = await coldCheckpointBinding(sql, d.manifest);
    return (
      !!owner &&
      row?.payload === payload &&
      row.epoch === owner.epoch &&
      checkpoint?.checkpointId === d.checkpointId &&
      row.checkpoint_binding === checkpoint.bytes
    );
  }
  return {
    /** Capture before reading source snapshots; any intervening mutation invalidates save. */
    async sourceEpoch() {
      await setupConversationColdResume(database);
      return Number(
        (
          await database.execute(
            'SELECT value FROM conversation_journal_epoch WHERE id = 1',
          )
        ).rows[0].value,
      );
    },
    /** Save after the durable safe boundary, before marking the active request interrupted. */
    async save(descriptor: ConversationColdResumeDescriptor) {
      const payload = encodeColdResume(descriptor);
      const d: ConversationColdResumeDescriptor = JSON.parse(payload);
      await setupConversationColdResume(database);
      await database.transaction(async sql => {
        const owner = await matches(sql, d, 'active');
        const checkpoint = await coldCheckpointBinding(sql, d.manifest);
        if (!owner || checkpoint?.checkpointId !== d.checkpointId)
          throw new Error('Cold resume boundary unavailable.');
        const previous = await stored(sql, d.manifest.requestId);
        if (previous) {
          const old: ConversationColdResumeDescriptor = JSON.parse(
            String(previous.payload),
          );
          if (
            old.attempt === d.attempt &&
            (previous.payload !== payload ||
              previous.checkpoint_binding !== checkpoint.bytes ||
              previous.epoch !== owner.epoch)
          )
            throw new Error('Cold resume boundary is immutable.');
        }
        await sql.execute(
          `INSERT OR REPLACE INTO conversation_cold_resumes
          (request_id, payload, checkpoint_binding, epoch) VALUES (?, ?, ?, ?)`,
          [d.manifest.requestId, payload, checkpoint.bytes, owner.epoch],
        );
      });
    },
    /** Returns data only for an unclaimed safe boundary; consumers must use allowlisted fresh factories. */
    async open(identity: ConversationContinuationIdentity) {
      await setupConversationColdResume(database);
      let result: ConversationColdResumeDescriptor | undefined;
      await database.transaction(async sql => {
        const row = await stored(sql, identity.requestId);
        if (typeof row?.payload !== 'string') return;
        try {
          const d: ConversationColdResumeDescriptor = JSON.parse(row.payload);
          if (
            encodeColdResume(d) !== row.payload ||
            d.manifest.requestId !== identity.requestId ||
            d.manifest.sessionId !== identity.sessionId ||
            d.manifest.sessionVersion !== identity.sessionVersion ||
            !(await current(sql, d, row.payload))
          )
            return;
          result = d;
        } catch {
          /* Malformed private data is unavailable, never a permissive fallback. */
        }
      });
      return result;
    },
    /** Recheck exact data after async adapters and atomically activate the original request once. */
    async claim(
      descriptor: ConversationColdResumeDescriptor,
      signal: AbortSignal,
      validate: (
        saved: ConversationColdResumeDescriptor,
        signal: AbortSignal,
      ) => Promise<boolean>,
    ) {
      const payload = encodeColdResume(descriptor);
      const d: ConversationColdResumeDescriptor = JSON.parse(payload);
      await setupConversationColdResume(database);
      const opened = await this.open(d.manifest);
      if (
        signal.aborted ||
        !opened ||
        encodeColdResume(opened) !== payload ||
        !(await validate(opened, signal)) ||
        signal.aborted ||
        encodeColdResume(opened) !== payload
      )
        throw new Error('Cold resume reconstruction changed or unavailable.');
      const store = createConversationWorkflowResumeStorage(
        database,
        async () => {},
        async sql => !signal.aborted && (await current(sql, d, payload)),
      );
      return store.claim(d.manifest, d.checkpointId, async sql => {
        if (signal.aborted) throw new Error('Cold resume cancelled.');
        await sql.execute(
          `UPDATE conversation_requests SET status = 'active', interruption_reason = NULL
          WHERE id = ? AND session_id = ? AND session_version = ? AND status = 'interrupted'`,
          [
            d.manifest.requestId,
            d.manifest.sessionId,
            d.manifest.sessionVersion,
          ],
        );
      });
    },
  };
}
