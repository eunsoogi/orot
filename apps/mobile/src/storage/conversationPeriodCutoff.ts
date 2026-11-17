import { localQueryTimestampKey, type SqlExecutor } from '@orot/storage';
import {
  parseHealthContextScope,
  type HealthContextScope,
} from '../healthEvidence/healthContext/scope';

interface PeriodCutoff {
  topic: string;
  from: string;
  to: string;
  cutoff: string | null;
}

function period(scope: HealthContextScope): PeriodCutoff {
  return {
    topic: scope.topic,
    from: localQueryTimestampKey(scope.window.fromInclusive),
    to: localQueryTimestampKey(scope.window.toExclusive),
    cutoff: scope.window.dataAvailableThrough
      ? localQueryTimestampKey(scope.window.dataAvailableThrough)
      : null,
  };
}

/** Multiple sources may share a period; an unbounded contributor must never acquire a cutoff. */
export async function appendConversationPeriod(
  tx: SqlExecutor,
  artifactId: string,
  scope: HealthContextScope,
): Promise<void> {
  const p = period(scope);
  await tx.execute(
    `INSERT INTO conversation_artifact_periods
      (artifact_id, topic, from_key, to_key, data_available_through_key)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (artifact_id, topic, from_key, to_key) DO UPDATE SET
      data_available_through_key = CASE
        WHEN conversation_artifact_periods.data_available_through_key IS NULL
          OR excluded.data_available_through_key IS NULL THEN NULL
        ELSE max(conversation_artifact_periods.data_available_through_key,
          excluded.data_available_through_key) END`,
    [artifactId, p.topic, p.from, p.to, p.cutoff],
  );
}

function historicalPeriods(serialized: unknown): PeriodCutoff[] {
  if (typeof serialized !== 'string') return [];
  try {
    const value: unknown = JSON.parse(serialized);
    if (!value || typeof value !== 'object' || !('sources' in value)) return [];
    if (!Array.isArray(value.sources)) return [];
    const groups = new Map<string, PeriodCutoff>();
    for (const source of value.sources) {
      if (!source || typeof source !== 'object') return [];
      if (source.kind !== 'health_context_period') continue;
      const scope = parseHealthContextScope(source.scope);
      // Ambiguous historical metadata retains the old conservative invalidation policy.
      if (!scope) return [];
      const next = period(scope);
      const key = JSON.stringify([next.topic, next.from, next.to]);
      const prior = groups.get(key);
      if (prior) {
        next.cutoff =
          prior.cutoff === null || next.cutoff === null
            ? null
            : prior.cutoff > next.cutoff
              ? prior.cutoff
              : next.cutoff;
      }
      groups.set(key, next);
    }
    return [...groups.values()];
  } catch {
    return [];
  }
}

/** Add snapshot metadata without rewriting answers or weakening unknown legacy dependencies.
 * The caller owns the schema transaction, so column addition and backfill commit together.
 */
export async function ensureConversationPeriodCutoff(
  tx: SqlExecutor,
): Promise<void> {
  const columns = await tx.execute(
    'PRAGMA table_info(conversation_artifact_periods)',
  );
  if (columns.rows.some(row => row.name === 'data_available_through_key'))
    return;
  await tx.execute(
    'ALTER TABLE conversation_artifact_periods ADD COLUMN data_available_through_key TEXT',
  );
  // Bounded pages avoid materializing the complete retained conversation history at once.
  let after: string | null = null;
  for (;;) {
    const page = await tx.execute(
      `SELECT id, result_json FROM conversation_artifacts
        WHERE (? IS NULL OR id > ?) AND EXISTS
          (SELECT 1 FROM conversation_artifact_periods p WHERE p.artifact_id = id)
        ORDER BY id LIMIT 100`,
      [after, after],
    );
    if (!page.rows.length) return;
    for (const row of page.rows) {
      for (const p of historicalPeriods(row.result_json)) {
        if (p.cutoff === null) continue;
        await tx.execute(
          `UPDATE conversation_artifact_periods SET data_available_through_key = ?
            WHERE artifact_id = ? AND topic = ? AND from_key = ? AND to_key = ?`,
          [p.cutoff, row.id, p.topic, p.from, p.to],
        );
      }
    }
    after = page.rows[page.rows.length - 1]!.id as string;
  }
}
