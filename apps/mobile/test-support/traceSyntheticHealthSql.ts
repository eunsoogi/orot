import type { SqlDatabase, SqlExecutor } from '@orot/storage';

/** Synthetic fixtures only. Exact equality keys stay in memory; output contains
 * fixed query categories, source callsites and aggregate timing, never bindings. */
export function traceSyntheticHealthSql(
  database: SqlDatabase,
  phase: () => string,
) {
  const originalExecute = database.execute;
  const originalTransaction = database.transaction;
  const groups = new Map<
    string,
    { count: number; ms: number; exact: Set<string> }
  >();
  const transactions: { phases: Record<string, number>; ms: number }[] = [];
  const classify = (sql: string) => {
    if (
      /^\s*(CREATE|DROP|ALTER|PRAGMA)\b/i.test(sql) ||
      /SELECT mutations, deletions FROM health_context_generation/i.test(sql) ||
      /\bWITH\s+(?:RECURSIVE\s+)?(?:days|calendar)\s*\(/i.test(sql) ||
      /\b(rag_embeddings|rag_embedding_models|rag_vector_document_revisions)\b/i.test(
        sql,
      ) ||
      !/\b(health_observations|dose_events|medication_definitions|symptom_entries)\b/i.test(
        sql,
      )
    )
      return undefined;
    if (/linked_ids\(id\)/.test(sql)) return 'period_removal_membership';
    if (/sqlite_master/.test(sql)) return 'schema_inspection';
    return 'other_health_sql';
  };
  const wrap =
    (
      execute: SqlExecutor['execute'],
      tx?: { phases: Record<string, number> },
    ): SqlExecutor['execute'] =>
    async (sql, bindings) => {
      const kind = classify(sql);
      if (!kind) return execute(sql, bindings);
      const currentPhase = phase();
      const stack = new Error().stack ?? '';
      const callsite = stack
        .split('\n')
        .slice(2)
        .map(
          line =>
            line.match(/(?:src|test-support)\/[A-Za-z0-9_./-]+\.tsx?/)?.[0],
        )
        .filter(
          line =>
            line &&
            !line.includes('test-support/') &&
            !line.includes('__tests__/'),
        )
        .slice(0, 3)
        .join(' > ');
      const key = `${currentPhase}|${tx ? 'transaction' : 'direct'}|${kind}|${callsite}`;
      const group = groups.get(key) ?? {
        count: 0,
        ms: 0,
        exact: new Set<string>(),
      };
      groups.set(key, group);
      group.count++;
      group.exact.add(JSON.stringify([sql, bindings]));
      if (tx) tx.phases[currentPhase] = (tx.phases[currentPhase] ?? 0) + 1;
      const started = performance.now();
      try {
        return await execute(sql, bindings);
      } finally {
        group.ms += performance.now() - started;
      }
    };
  database.execute = wrap(originalExecute.bind(database));
  database.transaction = work =>
    originalTransaction.call(database, async tx => {
      const row = { phases: {}, ms: 0 };
      transactions.push(row);
      const started = performance.now();
      const original = tx.execute;
      tx.execute = wrap(original.bind(tx), row);
      try {
        await work(tx);
      } finally {
        row.ms = performance.now() - started;
        tx.execute = original;
      }
    });
  return {
    summary: () => ({
      groups: [...groups].map(([boundary, g]) => ({
        boundary,
        count: g.count,
        exactStatements: g.exact.size,
        executeMs: Math.round(g.ms),
      })),
      transactions,
    }),
    restore() {
      database.execute = originalExecute;
      database.transaction = originalTransaction;
      groups.clear();
    },
  };
}
