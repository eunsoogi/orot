import { reportRecentSourceFailure } from '../providers/recentSourceFailureDiagnostic';
import { localQueryTimestampKey, type SqlDatabase } from '@orot/storage';
import {
  readCatalog,
  type CatalogCursor,
  type RecentMaterialRow,
} from './catalog';
import { recentMaterialTimestamp } from './recentMaterialTimestamp';
import type { SqlExecutor, SqlValue } from '@orot/storage';
import {
  BoundReadRevisionChanged,
  BoundReadWitnessUnavailable,
  createBoundReadResultWitness,
  guardedBoundTransaction,
} from '../storage/boundReadResultWitness';

const agentKeyPrefix = 'memory:agent:';
const probeSize = 8;
const sourceVersion = 1;
const supersessionId =
  "CASE WHEN json_valid(payload_json) THEN json_extract(payload_json,'$.supersedesId') END";
const supersessionIndex = 'transcript_segments_recent_memory_superseded_idx';
const exactSupersessionIndex =
  'CREATE INDEX ' +
  supersessionIndex +
  ' ON transcript_segments(' +
  supersessionId +
  ') WHERE ' +
  supersessionId +
  ' IS NOT NULL';
export type AgentProbeCursor = {
  readonly id: string;
  readonly createdAtMs: number;
};
type AgentMemoryMetadata = Extract<RecentMaterialRow, { origin: 'memory' }>;

function seekTime(cursor?: CatalogCursor) {
  if (!cursor) return;
  const date = recentMaterialTimestamp(cursor.createdAt);
  const ms = Date.parse(date);
  if (!Number.isFinite(ms)) throw new BoundReadWitnessUnavailable();
  // SQLite keys retain all source fractional digits; memory clocks are integers.
  // When the cursor is within a millisecond, every memory at its floor is older.
  const extra = (
    date.match(/\.(\d+)(?=(?:Z|[+-]\d{2}:\d{2})$)/i)?.[1] ?? ''
  ).slice(3);
  if (/[1-9]/.test(extra)) return { ms, equal: true };
  if (cursor.key.startsWith(agentKeyPrefix))
    return { ms, equal: true, id: cursor.key.slice(agentKeyPrefix.length) };
  // Prefix comparison is ASCII until the first differing byte. No other stream
  // key can be an agent key: current manual note IDs have their own namespace.
  return { ms, equal: cursor.key > agentKeyPrefix };
}

async function readAttestedIndexProbe(
  tx: SqlExecutor,
  before: CatalogCursor | undefined,
  resume: AgentProbeCursor | undefined,
  hasQuarantine: boolean,
) {
  const seek = resume
    ? { ms: resume.createdAtMs, equal: true, id: resume.id }
    : seekTime(before);
  const read = (
    predicate: string,
    parameters: readonly SqlValue[],
    limit: number,
  ) =>
    tx.execute(
      'SELECT id, recent_created_at_ms AS clock FROM agent_memory_records ' +
        'INDEXED BY agent_memory_recent_metadata_idx WHERE recent_metadata_version=? ' +
        predicate +
        ' ORDER BY recent_created_at_ms DESC,id COLLATE BINARY DESC LIMIT ?',
      [sourceVersion, ...parameters, limit],
    );
  const at = seek?.equal
    ? (
        await read(
          'AND recent_created_at_ms=?' +
            (seek.id === undefined ? '' : ' AND id COLLATE BINARY<?'),
          seek.id === undefined ? [seek.ms] : [seek.ms, seek.id],
          probeSize,
        )
      ).rows
    : [];
  const older =
    at.length < probeSize
      ? (
          await read(
            seek ? 'AND recent_created_at_ms<?' : '',
            seek ? [seek.ms] : [],
            probeSize - at.length,
          )
        ).rows
      : [];
  const raw = [...at, ...older];
  const entries = [];
  for (const row of raw) {
    if (
      typeof row.id !== 'string' ||
      row.id.length === 0 ||
      typeof row.clock !== 'number' ||
      !Number.isSafeInteger(row.clock) ||
      !Number.isFinite(new Date(row.clock).getTime())
    )
      throw new BoundReadWitnessUnavailable();
    const key = agentKeyPrefix + row.id;
    const createdAt = new Date(row.clock).toISOString();
    const excluded = (
      await tx.execute(
        'SELECT EXISTS(SELECT 1 FROM agent_memory_removed_sources WHERE source_id=?)' +
          (hasQuarantine
            ? ' OR EXISTS(SELECT 1 FROM memory_parent_quarantine WHERE memory_id=?)'
            : '') +
          ' OR EXISTS(SELECT 1 FROM transcript_segments INDEXED BY ' +
          supersessionIndex +
          ' WHERE ' +
          supersessionId +
          '=? AND ' +
          supersessionId +
          ' IS NOT NULL) AS excluded',
        hasQuarantine ? [row.id, row.id, row.id] : [row.id, row.id],
      )
    ).rows[0]?.excluded;
    if (excluded !== 0 && excluded !== 1)
      throw new BoundReadWitnessUnavailable();
    const admitted: AgentMemoryMetadata | undefined =
      excluded === 0
        ? { key, id: row.id, createdAt, origin: 'memory' }
        : undefined;
    entries.push({
      position: { key, clock: localQueryTimestampKey(createdAt) },
      cursor: { id: row.id, createdAtMs: row.clock },
      admitted,
    });
  }
  return { entries, exhausted: raw.length < probeSize };
}

/** Private seam only: do not open the feed until an actual authoritative
 * legacy attestation/readiness gate and the indexed supersession contract exist. */
export function openAttestedMemoryProbe(
  database: SqlDatabase,
  isRouteCurrent: () => boolean,
  signal: AbortSignal,
) {
  const currentOwner = () => !signal.aborted && isRouteCurrent();
  // Do not queue a new catalog behind a writer already known to be dirty.
  // Its next statement could invalidate a same-connection witness before the
  // queued catalog even starts. Wait for native settlement at first admission.
  const sensor = createBoundReadResultWitness(database, currentOwner, {
    requireSettledOwner: true,
  });
  if (!sensor || !currentOwner()) {
    sensor?.dispose();
    throw new BoundReadWitnessUnavailable();
  }
  const close = () => {
    sensor.dispose();
    signal.removeEventListener('abort', close);
  };
  signal.addEventListener('abort', close, { once: true });
  return {
    close,
    requestWitness: sensor,
    witness: {
      isCurrent: sensor.current,
      requireCurrent: sensor.requireCurrent,
      async verify(rethrowRevision?: true) {
        try {
          await guardedBoundTransaction(database, sensor, async () => {});
          sensor.requireCurrent();
          return true;
        } catch (error) {
          if (rethrowRevision && error instanceof BoundReadRevisionChanged)
            throw error;
          return false;
        }
      },
    },
    async ordinary(before?: CatalogCursor, limit?: number) {
      let rows: readonly RecentMaterialRow[] = [];
      await guardedBoundTransaction(database, sensor, async tx => {
        rows = await readCatalog(tx, before, true, signal, limit);
      });
      // Native settlement can yield to a writer after the final sample.
      // Keep the typed revision error so only a fresh first page can restart.
      sensor.requireCurrent();
      return rows;
    },
    async read(before?: CatalogCursor, resume?: AgentProbeCursor) {
      let result:
        Awaited<ReturnType<typeof readAttestedIndexProbe>> | undefined;
      let phase:
        | 'recent_records_agent_slice'
        | 'recent_records_agent_schema'
        | 'recent_records_agent_legacy' = 'recent_records_agent_slice';
      try {
        await guardedBoundTransaction(database, sensor, async tx => {
          phase = 'recent_records_agent_schema';
          const schema = await tx.execute(
            "SELECT name,sql FROM sqlite_master WHERE name IN ('" +
              supersessionIndex +
              "','memory_parent_quarantine','agent_memory_removed_sources')",
          );
          if (
            !schema.rows.some(
              row =>
                row.name === supersessionIndex &&
                typeof row.sql === 'string' &&
                row.sql.replace(/\s+/g, ' ') === exactSupersessionIndex,
            ) ||
            !schema.rows.some(
              row => row.name === 'agent_memory_removed_sources',
            )
          )
            throw new BoundReadWitnessUnavailable();
          phase = 'recent_records_agent_legacy';
          const stillPending = await tx.execute(
            'SELECT id FROM agent_memory_records INDEXED BY agent_memory_legacy_pending_idx WHERE recent_legacy_pending = 1 LIMIT 1',
          );
          if (stillPending.rows.length) throw new BoundReadWitnessUnavailable();
          phase = 'recent_records_agent_slice';
          result = await readAttestedIndexProbe(
            tx,
            before,
            resume,
            schema.rows.some(row => row.name === 'memory_parent_quarantine'),
          );
        });
        sensor.requireCurrent();
        if (!result) throw new BoundReadWitnessUnavailable();
        return result;
      } catch (error) {
        reportRecentSourceFailure(phase, error, signal);
        throw error;
      }
    },
  };
}
