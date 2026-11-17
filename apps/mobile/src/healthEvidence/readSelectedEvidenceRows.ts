import type { SqlExecutor, SqlValue } from '@orot/storage';

/** Read the complete caller-selected scope in transport pages within its existing
 * transaction. Page size limits each native transfer, never the resulting scope. */
export async function readSelectedEvidenceRows(
  executor: SqlExecutor,
  sql: string,
  parameters: readonly SqlValue[],
  signal?: AbortSignal,
): Promise<{ rows: Array<Record<string, unknown>> }> {
  const rows: Array<Record<string, unknown>> = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    checkHealthEvidenceAbort(signal);
    const page = await executor.execute(`${sql} LIMIT ? OFFSET ?`, [
      ...parameters,
      pageSize,
      offset,
    ]);
    checkHealthEvidenceAbort(signal);
    rows.push(...page.rows);
    if (page.rows.length < pageSize) return { rows };
    // Yield to Stop/navigation between pages even when the database port resolves synchronously.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
}

function checkHealthEvidenceAbort(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  const error = new Error('The selected evidence read was cancelled.');
  error.name = 'AbortError';
  throw error;
}
