import type { SqlDatabase, SqlTransaction } from '@orot/storage';
import { projectRecentAgentMemoryWitness } from './agentMemoryStorageRecords';

export type LegacyMemorySweepStatus = 'pending' | 'deferred' | 'ready';
export interface LegacyMemorySweepResult {
  readonly status: LegacyMemorySweepStatus;
  readonly after?: number | null;
  readonly changed: boolean;
}

interface LegacyMemoryLease {
  readonly current: () => boolean;
  readonly confirm: () => Promise<boolean>;
  readonly after?: number | null;
}

const pending = 'recent_legacy_pending=1';
const transcriptSupersedes =
  "CASE WHEN json_valid(payload_json) THEN json_extract(payload_json,'$.supersedesId') END";
const rowsPerQuantum = 8;
// Budget raw bytes going both directions (read and exact equality rebind).
// It is a work budget, not an eligibility limit: large rows stay pending.
const rawByteBudget = 128 * 1024;

function metadataSql(after: number | null | undefined) {
  const bound =
    after != null
      ? 'AND id COLLATE BINARY > (SELECT id FROM agent_memory_records WHERE rowid=?)'
      : '';
  return `SELECT rowid AS candidate, octet_length(id) AS id_bytes,
      octet_length(record_json) AS body_bytes
    FROM agent_memory_records WHERE ${pending} ${bound}
    ORDER BY id COLLATE BINARY LIMIT ?`;
}

async function markerTables(tx: SqlTransaction) {
  const names = (
    await tx.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('agent_memory_removed_sources','memory_parent_quarantine')",
    )
  ).rows;
  return new Set(names.map(row => row.name));
}

async function markExamined(
  tx: SqlTransaction,
  candidate: number,
  id: string,
  body: string,
) {
  const stamp = projectRecentAgentMemoryWitness(id, body);
  const update = await tx.execute(
    `UPDATE agent_memory_records
      SET recent_legacy_pending=0,recent_metadata_version=?,recent_created_at_ms=?
      WHERE rowid=? AND id=? AND record_json=? AND ${pending}`,
    [stamp?.version ?? null, stamp?.createdAt ?? null, candidate, id, body],
  );
  if (update.rowsAffected !== 1) throw new Error('Legacy Memory was changed.');
  return stamp !== null;
}

interface ProbeRow {
  candidate?: unknown;
  id_bytes?: unknown;
  body_bytes?: unknown;
}
function candidateMetadata(row: ProbeRow) {
  const { candidate, id_bytes: id, body_bytes: body } = row;
  if (
    typeof candidate !== 'number' ||
    !Number.isSafeInteger(candidate) ||
    typeof id !== 'number' ||
    !Number.isSafeInteger(id) ||
    id < 0 ||
    typeof body !== 'number' ||
    !Number.isSafeInteger(body) ||
    body < 0
  )
    return null;
  return { candidate, id, body };
}

/** One protected quantum; only this migration owner decodes legacy bodies.
 * A positive native lease must survive to the synchronous commit boundary. */
export async function runLegacyMemorySweep(
  database: SqlDatabase,
  lease: LegacyMemoryLease,
): Promise<LegacyMemorySweepResult> {
  if (!lease.current() || !(await lease.confirm()) || !lease.current())
    throw new Error('Protected Memory maintenance is no longer available.');
  let result: LegacyMemorySweepResult | undefined;
  await database.transaction(async tx => {
    const current = () => {
      if (!lease.current())
        throw new Error('Protected Memory maintenance owner changed.');
    };
    current();
    let byteProbe: unknown;
    try {
      byteProbe = (await tx.execute("SELECT octet_length('가') AS actual"))
        .rows[0]?.actual;
    } catch {
      // Never fall back to bringing whole bodies through the bridge.
    }
    if (byteProbe !== 3) {
      current();
      result = { status: 'deferred', changed: false };
      return;
    }
    current();
    const { after } = lease;
    if (
      after != null &&
      !(
        await tx.execute('SELECT 1 FROM agent_memory_records WHERE rowid=?', [
          after,
        ])
      ).rows.length
    ) {
      // A deleted anchor cannot be resolved by its old id. Return a fresh seek
      // once; already committed statuses make the rewalk idempotent.
      current();
      result = { status: 'pending', after: null, changed: false };
      return;
    }
    const rows = (
      await tx.execute(
        metadataSql(after),
        after != null ? [after, rowsPerQuantum] : [rowsPerQuantum],
      )
    ).rows;
    current();
    let frontier = after;
    let changed = false;
    let remaining = rawByteBudget;
    let next = false;
    if (rows.length) {
      const tables = await markerTables(tx);
      if (!tables.has('agent_memory_removed_sources')) {
        current();
        result = { status: 'deferred', changed: false };
        return;
      }
      const quarantine = tables.has('memory_parent_quarantine')
        ? 'OR EXISTS(SELECT 1 FROM memory_parent_quarantine WHERE memory_id=?1)'
        : '';
      for (const raw of rows) {
        const p = candidateMetadata(raw);
        if (!p) {
          current();
          result = { status: 'deferred', changed };
          break;
        }
        if (p.id > rawByteBudget / 4 || p.body > rawByteBudget / 2) {
          frontier = p.candidate;
          continue;
        }
        const charge = p.id * 4 + p.body * 2;
        if (charge > rawByteBudget) {
          frontier = p.candidate;
          continue;
        }
        if (charge > remaining) {
          next = true;
          break;
        }
        // Use the bounded ID as a bound parameter for marker seeks. A
        // correlated expression comparison scans the supersession index.
        const id = (
          await tx.execute(
            `SELECT id FROM agent_memory_records
            WHERE rowid=? AND ${pending} AND octet_length(id)=?`,
            [p.candidate, p.id],
          )
        ).rows[0]?.id;
        current();
        if (typeof id !== 'string')
          throw new Error('Legacy Memory was changed.');
        const denied = (
          await tx.execute(
            `SELECT (EXISTS(SELECT 1 FROM agent_memory_removed_sources WHERE source_id=?1)
              OR EXISTS(SELECT 1 FROM transcript_segments WHERE ${transcriptSupersedes} = ?1 AND ${transcriptSupersedes} IS NOT NULL)
              ${quarantine}) AS denied`,
            [id],
          )
        ).rows[0]?.denied;
        current();
        remaining -= charge;
        if (denied === 1) {
          const blocked = await tx.execute(
            `UPDATE agent_memory_records SET recent_legacy_pending=0
               WHERE rowid=? AND ${pending}`,
            [p.candidate],
          );
          if (blocked.rowsAffected !== 1)
            throw new Error('Legacy Memory was changed.');
        } else if (denied === 0) {
          const body = (
            await tx.execute(
              `SELECT record_json FROM agent_memory_records
              WHERE rowid=? AND id=? AND ${pending} AND octet_length(record_json)=?`,
              [p.candidate, id, p.body],
            )
          ).rows[0]?.record_json;
          current();
          if (typeof body !== 'string')
            throw new Error('Legacy Memory was changed.');
          changed = (await markExamined(tx, p.candidate, id, body)) || changed;
        } else {
          throw new Error('Legacy Memory was changed.');
        }
        current();
        frontier = p.candidate;
      }
    }
    if (!result) {
      if ((next || rows.length === rowsPerQuantum) && frontier != null) {
        result = { status: 'pending', after: frontier, changed };
      } else {
        const outstanding =
          (
            await tx.execute(
              `SELECT 1 FROM agent_memory_records WHERE ${pending} LIMIT 1`,
            )
          ).rows.length !== 0;
        result = { status: outstanding ? 'deferred' : 'ready', changed };
      }
    }
    if (!(await lease.confirm()))
      throw new Error('Protected Memory maintenance is no longer available.');
    current();
    tx.commit();
  });
  if (!result) throw new Error('Protected Memory maintenance did not settle.');
  return result;
}
