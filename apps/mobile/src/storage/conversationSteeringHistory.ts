import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import type { StoredSteeringInstruction } from './conversationSteeringStorage';
import { steeringReceiptTimes } from './conversationSteeringReceiptTimes';

type History = ReadonlyMap<string, readonly StoredSteeringInstruction[]>;

/** Optional steering tables are created lazily and may differ on older installs. */
export const steeringHistorySchemaSql = `(SELECT COALESCE(SUM(CASE name
  WHEN 'conversation_steering' THEN 1
  WHEN 'conversation_live_steering' THEN 2
  WHEN 'conversation_steering_receipt_times' THEN 4
  END), 0) FROM sqlite_master WHERE type = 'table'
  AND name IN ('conversation_steering', 'conversation_live_steering', 'conversation_steering_receipt_times'))`;

/** Read only already-eligible committed requests from the current owned display page. */
export async function readConversationSteeringHistoryMany(
  sql: SqlExecutor,
  sessionId: string,
  version: number,
  requestIds: readonly string[],
  knownSchema?: number,
): Promise<History> {
  const restored = new Map<string, StoredSteeringInstruction[]>();
  if (!requestIds.length) return restored;
  const schema =
    knownSchema ??
    Number(
      (await sql.execute(`SELECT ${steeringHistorySchemaSql} AS steering`))
        .rows[0]?.steering ?? 0,
    );
  if (schema % 2 !== 1) return restored;
  const hasLive = Math.floor(schema / 2) % 2 === 1;
  const hasTimes = schema >= 4;
  const { rows } = await sql.execute(
    `SELECT request_id, run_id, id, text, sequence, status, live_status, submitted_at, sent_at, read_at
     FROM (
       SELECT q.request_id, q.run_id, q.id, q.text, q.sequence, q.status,
       ${hasLive ? 'l.status' : 'NULL'} AS live_status,
       ${hasTimes ? 't.submitted_at, t.sent_at, t.read_at' : 'NULL AS submitted_at, NULL AS sent_at, NULL AS read_at'},
       ROW_NUMBER() OVER (PARTITION BY q.request_id ORDER BY q.sequence, q.run_id) AS position
       FROM conversation_steering q JOIN json_each(?) ids ON q.request_id = ids.value
       ${hasLive ? 'LEFT JOIN conversation_live_steering l ON l.request_id=q.request_id AND l.run_id=q.run_id AND l.id=q.id' : ''}
       ${hasTimes ? 'LEFT JOIN conversation_steering_receipt_times t ON t.request_id=q.request_id AND t.run_id=q.run_id AND t.id=q.id' : ''}
       JOIN conversation_requests r ON r.id = q.request_id
       JOIN conversation_artifact_sessions s ON s.id = r.session_id
       JOIN conversation_artifact_generation g ON g.singleton = 1
       WHERE r.session_id = ? AND r.session_version = ? AND r.status = 'completed'
       AND s.version = ? AND s.hidden = 0 AND s.generation = g.generation
     ) selected WHERE position <= 17 ORDER BY request_id, position`,
    [JSON.stringify([...new Set(requestIds)]), sessionId, version, version],
  );
  const rejected = new Set<string>();
  const runIds = new Map<string, string>();
  for (const row of rows) {
    if (typeof row.request_id !== 'string') continue;
    const id = row.request_id;
    if (rejected.has(id)) continue;
    const records = restored.get(id) ?? [];
    if (
      records.length >= 16 ||
      typeof row.run_id !== 'string' ||
      (runIds.has(id) && runIds.get(id) !== row.run_id) ||
      typeof row.id !== 'string' ||
      typeof row.text !== 'string' ||
      row.text.length > 1000 ||
      typeof row.sequence !== 'number' ||
      !Number.isSafeInteger(row.sequence) ||
      row.sequence <= (records.at(-1)?.sequence ?? 0) ||
      (row.status !== 'applied' &&
        row.status !== 'not_applied' &&
        row.status !== 'delivery_pending')
    ) {
      restored.delete(id);
      rejected.add(id);
      continue;
    }
    runIds.set(id, row.run_id);
    records.push({
      id: row.id,
      text: row.text,
      sequence: row.sequence,
      status: row.status,
      ...steeringReceiptTimes(row),
      ...(row.live_status === 'accepted' || row.live_status === 'pending'
        ? { serverAccepted: true }
        : {}),
    });
    restored.set(id, records);
  }
  return restored;
}

/** Legacy restore shares the same bounded receipt query, without constructing resume authority. */
export function conversationSteeringHistory(
  database: SqlDatabase,
  ensure: () => Promise<void>,
) {
  return async (
    sessionId: string,
    version: number,
    requestId: string,
    signal: AbortSignal,
  ): Promise<readonly StoredSteeringInstruction[]> => {
    await ensure();
    let restored: History | undefined;
    await database.transaction(async sql => {
      if (!signal.aborted)
        restored = await readConversationSteeringHistoryMany(
          sql,
          sessionId,
          version,
          [requestId],
        );
    });
    return signal.aborted ? [] : (restored?.get(requestId) ?? []);
  };
}
