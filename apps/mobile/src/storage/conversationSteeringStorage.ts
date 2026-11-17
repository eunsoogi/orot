import { createLiveSteering } from './conversationLiveSteering';
import type { LanguageModelRequest } from '@orot/model-runtime';
import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import { stableJson } from '../aiFeatures/integration/evidenceUtils';
import { setupConversationSteering } from './conversationSteeringSchema';
import { steeringReceiptTimes } from './conversationSteeringReceiptTimes';

export interface StoredSteeringInstruction {
  readonly id: string;
  readonly text: string;
  readonly sequence: number;
  /** True only after the live provider acknowledges this instruction. */
  readonly serverAccepted?: boolean;
  /** Local user submission time, never a transmission receipt. */
  readonly submittedAt?: string;
  /** Local observation times of real provider receipts, not provider clock or user comprehension. */
  readonly sentAt?: string;
  readonly readAt?: string;
  readonly status:
    'queued' | 'prepared' | 'applied' | 'not_applied' | 'delivery_pending';
}
/**
 * Serialized protected-DB operations. An operation's first bound payload is immutable;
 * later messages remain queued even if approval is still waiting. No call is sent here.
 */
export async function createConversationSteeringStorage(input: {
  database: SqlDatabase;
  requestId: string;
  runId: string;
  live(sql: SqlExecutor, epoch: number): Promise<boolean>;
}) {
  const { database, requestId, runId } = input;
  await setupConversationSteering(database);
  const keys = [requestId, runId];
  const listeners = new Set<() => Promise<void>>();
  const emit = () =>
    Promise.all([...listeners].map(listener => listener().catch(() => {})));
  async function live(sql: SqlExecutor) {
    const epoch = (
      await sql.execute(
        'SELECT value FROM conversation_journal_epoch WHERE id = 1',
      )
    ).rows[0]?.value;
    return typeof epoch === 'number' && input.live(sql, epoch);
  }
  async function read(sql: SqlExecutor): Promise<StoredSteeringInstruction[]> {
    const rows = (
      await sql.execute(
        `SELECT q.id, q.text, q.sequence, q.status, l.status AS live_status, t.submitted_at, t.sent_at, t.read_at
         FROM conversation_steering q LEFT JOIN conversation_live_steering l
         ON l.request_id=q.request_id AND l.run_id=q.run_id AND l.id=q.id
         LEFT JOIN conversation_steering_receipt_times t
         ON t.request_id=q.request_id AND t.run_id=q.run_id AND t.id=q.id
         WHERE q.request_id = ? AND q.run_id = ? ORDER BY q.sequence`,
        keys,
      )
    ).rows;
    return rows.map(row => ({
      id: String(row.id),
      text: String(row.text),
      sequence: Number(row.sequence),
      status: row.status as StoredSteeringInstruction['status'],
      ...steeringReceiptTimes(row),
      ...(row.live_status === 'accepted' || row.live_status === 'pending'
        ? { serverAccepted: true }
        : {}),
    }));
  }
  return {
    ...createLiveSteering({ database, keys, live, emit }),
    subscribe(listener: () => Promise<void>) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async enqueue(id: string, text: string): Promise<boolean> {
      const submittedAt = new Date().toISOString();
      if (!id.trim() || id.length > 128 || !text.trim()) return false;
      let accepted = false;
      await database.transaction(async sql => {
        if (!(await live(sql))) return;
        const rows = await read(sql);
        const previous = rows.find(row => row.id === id);
        if (previous) {
          accepted = previous.text === text;
          return;
        }
        await sql.execute(
          'INSERT INTO conversation_steering VALUES (?, ?, ?, ?, ?, ?)',
          [...keys, id, rows.length + 1, text, 'queued'],
        );
        await sql.execute(
          'INSERT INTO conversation_steering_receipt_times (request_id, run_id, id, submitted_at) VALUES (?, ?, ?, ?)',
          [...keys, id, submittedAt],
        );
        accepted = true;
      });
      if (accepted) await emit();
      return accepted;
    },
    async list(): Promise<StoredSteeringInstruction[]> {
      let result: StoredSteeringInstruction[] = [];
      await database.transaction(async sql => {
        if (await live(sql)) result = await read(sql);
      });
      return result;
    },
    async bind(
      operationId: string,
      request: LanguageModelRequest,
    ): Promise<LanguageModelRequest | undefined> {
      if (!operationId || operationId.length > 300) return undefined;
      const base = stableJson(request);
      let result: LanguageModelRequest | undefined;
      await database.transaction(async sql => {
        if (!(await live(sql))) return;
        const existing = (
          await sql.execute(
            'SELECT * FROM conversation_steering_bindings WHERE request_id = ? AND run_id = ? AND operation_id = ?',
            [...keys, operationId],
          )
        ).rows[0];
        if (existing) {
          // Cold reconstruction may already carry the exact previously bound payload.
          if (base === existing.base || base === existing.payload)
            result = JSON.parse(String(existing.payload));
          return;
        }
        const prior = (
          await sql.execute(
            'SELECT operation_id FROM conversation_operation_journal WHERE request_id=? AND run_id=? AND operation_id=?',
            [...keys, operationId],
          )
        ).rows[0];
        // Old journal entries predate steering; preserve their exact reconstruction and CAS checks.
        if (prior) {
          result = request;
          return;
        }
        // An optional read-only review can remain unconfirmed without consuming task
        // steering. Its own intent still cannot replay; cold resume remains fail-closed.
        const pending = (
          await sql.execute(
            "SELECT operation_id FROM conversation_operation_journal WHERE request_id = ? AND run_id = ? AND status = 'pending' AND (purpose IS NULL OR purpose <> 'preview_review') LIMIT 1",
            keys,
          )
        ).rows[0];
        if (pending) return;
        const liveRows = (
          await sql.execute(
            "SELECT id FROM conversation_live_steering WHERE request_id=? AND run_id=? AND status IN ('sent', 'accepted', 'pending')",
            keys,
          )
        ).rows;
        const uncertain = new Set(liveRows.map(row => String(row.id)));
        const rows = (await read(sql)).filter(
          row => row.status !== 'not_applied' && !uncertain.has(row.id),
        );
        if (!rows.length) {
          result = request;
          return;
        }
        const payload: LanguageModelRequest = {
          ...request,
          messages: [
            ...request.messages,
            ...rows.map(row => ({ role: 'user' as const, content: row.text })),
          ],
        };
        const serialized = stableJson(payload);
        const through = rows.at(-1)?.sequence ?? 0;
        await sql.execute(
          'INSERT INTO conversation_steering_bindings VALUES (?, ?, ?, ?, ?, ?)',
          [...keys, operationId, base, serialized, through],
        );
        await sql.execute(
          "UPDATE conversation_steering SET status = 'prepared' WHERE request_id = ? AND run_id = ? AND sequence <= ? AND status = 'queued'",
          [...keys, through],
        );
        result = payload;
      });
      return result;
    },
    async acknowledge(operationId: string): Promise<boolean> {
      const observedAt = new Date().toISOString();
      let accepted = false;
      await database.transaction(async sql => {
        if (!(await live(sql))) return;
        const row = (
          await sql.execute(
            `SELECT b.through_sequence FROM conversation_steering_bindings b
          JOIN conversation_operation_journal j ON j.request_id=b.request_id AND j.run_id=b.run_id AND j.operation_id=b.operation_id
          WHERE b.request_id=? AND b.run_id=? AND b.operation_id=? AND j.status='completed'`,
            [...keys, operationId],
          )
        ).rows[0];
        if (!row) return;
        // Only newly prepared input acknowledged by a completed journal call gets a read time.
        await sql.execute(
          `INSERT INTO conversation_steering_receipt_times (request_id, run_id, id, read_at)
           SELECT request_id, run_id, id, ? FROM conversation_steering
           WHERE request_id=? AND run_id=? AND sequence<=? AND status='prepared'
           ON CONFLICT(request_id, run_id, id) DO UPDATE SET read_at=COALESCE(read_at, excluded.read_at)`,
          [observedAt, ...keys, row.through_sequence],
        );
        await sql.execute(
          "UPDATE conversation_steering SET status='applied' WHERE request_id=? AND run_id=? AND sequence<=? AND status='prepared'",
          [...keys, row.through_sequence],
        );
        accepted = true;
      });
      if (accepted) await emit();
      return accepted;
    },
  };
}
