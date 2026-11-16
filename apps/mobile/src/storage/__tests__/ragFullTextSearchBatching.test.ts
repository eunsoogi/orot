import type { SqlDatabase } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { chunk } from '../testSupport/vectorStore';
import { SqlCipherRagFullTextSearchStore } from '../ragFullTextSearch';

/** Real SQLite checks preserve lexical ordering; call counts are not device latency. */
test('bounds insert bridge calls without changing single-row FTS ranking', async () => {
  const opened = openSqliteTestDatabase(':memory:');
  const sizes: number[] = [];
  const database: SqlDatabase = {
    execute: (...args) => opened.database.execute(...args),
    transaction: operation =>
      opened.database.transaction(transaction =>
        operation({
          ...transaction,
          execute: (sql, values) => {
            if (sql.startsWith('INSERT INTO temp.rag_fts_query_'))
              sizes.push(values!.length);
            return transaction.execute(sql, values);
          },
        }),
      ),
  };
  const chunks = Array.from({ length: 500 }, (_, index) => ({
    ...chunk(`synthetic-${String(index).padStart(3, '0')}`),
    text:
      index % 3
        ? 'synthetic keyword note'
        : 'keyword keyword longer synthetic note',
  }));
  try {
    await opened.database.execute(
      "CREATE VIRTUAL TABLE temp.reference_fts USING fts5(chunk_id UNINDEXED, body, tokenize = 'unicode61')",
    );
    for (const item of chunks)
      await opened.database.execute(
        'INSERT INTO temp.reference_fts VALUES (?, ?)',
        [item.id, item.text],
      );
    const expected = await opened.database.execute(
      'SELECT chunk_id FROM temp.reference_fts WHERE body MATCH ? ORDER BY bm25(reference_fts) ASC, chunk_id ASC LIMIT ?',
      ['"keyword"*', 75],
    );
    const result = await new SqlCipherRagFullTextSearchStore(database).search(
      'keyword',
      chunks,
      75,
    );
    expect(result).toEqual(
      expected.rows.map(row => ({ chunkId: row.chunk_id })),
    );
    expect(sizes).toHaveLength(16);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(64);
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(1000);
  } finally {
    opened.close();
  }
});

test.each(['abort', 'abort-final', 'failure'] as const)(
  'cleans partial batches after %s and permits a fresh query',
  async mode => {
    const opened = openSqliteTestDatabase(':memory:');
    const controller = new AbortController();
    let inserts = 0;
    let selects = 0;
    const database: SqlDatabase = {
      execute: (...args) => opened.database.execute(...args),
      transaction: operation =>
        opened.database.transaction(transaction =>
          operation({
            ...transaction,
            async execute(sql, values) {
              if (sql.startsWith('SELECT chunk_id')) selects++;
              if (
                sql.startsWith('INSERT INTO temp.rag_fts_query_') &&
                ++inserts === 2
              ) {
                if (mode === 'failure')
                  throw new Error('synthetic insert failure');
                const result = await transaction.execute(sql, values);
                controller.abort();
                return result;
              }
              return transaction.execute(sql, values);
            },
          }),
        ),
    };
    try {
      const search = new SqlCipherRagFullTextSearchStore(database);
      await expect(
        search.search(
          'Synthetic',
          Array.from({ length: mode === 'abort-final' ? 64 : 65 }, (_, index) =>
            chunk(`synthetic-${index}`),
          ),
          5,
          controller.signal,
        ),
      ).rejects.toThrow(
        mode !== 'failure'
          ? 'Full-text search was cancelled.'
          : 'synthetic insert failure',
      );
      expect(inserts).toBe(2);
      expect(selects).toBe(0);
      expect(
        (
          await opened.database.execute(
            "SELECT name FROM sqlite_temp_master WHERE name LIKE 'rag_fts_query_%'",
          )
        ).rows,
      ).toEqual([]);
      expect(await search.search('Synthetic', [chunk('fresh')], 1)).toEqual([
        { chunkId: 'fresh' },
      ]);
    } finally {
      opened.close();
    }
  },
);
