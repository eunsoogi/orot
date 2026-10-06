import type {
  EvidenceChunk,
  LocalFullTextSearchMatch,
  LocalFullTextSearchStore,
} from '@orot/rag';
import { LocalEmbeddingJobError } from '@orot/rag';
import type { SqlDatabase } from '@orot/storage';

let nextTemporaryTableId = 0;

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error('Full-text search was cancelled.');
    error.name = 'AbortError';
    throw error;
  }
}

function buildMatchExpression(query: string): string {
  // Interpret input as literal Unicode prefixes so punctuation cannot become FTS query syntax.
  const tokens = query.normalize('NFKC').match(/[\p{L}\p{M}\p{N}_]+/gu) ?? [];
  return [...new Set(tokens.map(token => token.toLowerCase()))]
    .map(token => `"${token.replace(/"/g, '""')}"*`)
    .join(' OR ');
}

function validateChunks(chunks: readonly EvidenceChunk[]): void {
  const seen = new Set<string>();
  for (const chunk of chunks) {
    if (!chunk.id || !chunk.text.trim() || seen.has(chunk.id)) {
      throw new LocalEmbeddingJobError(
        'invalid_request',
        'Full-text search needs unique chunk IDs and non-empty text.',
      );
    }
    seen.add(chunk.id);
  }
}

/** Uses SQLCipher's in-memory TEMP store so source text is not copied into a persistent search index. */
export class SqlCipherRagFullTextSearchStore implements LocalFullTextSearchStore {
  private tempStoreReady: Promise<void> | null = null;

  constructor(private readonly database: SqlDatabase) {}

  async search(
    query: string,
    chunks: readonly EvidenceChunk[],
    limit: number,
    signal?: AbortSignal,
  ): Promise<readonly LocalFullTextSearchMatch[]> {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new LocalEmbeddingJobError(
        'invalid_request',
        'Full-text result count must be a positive integer.',
      );
    }
    validateChunks(chunks);
    const matchExpression = buildMatchExpression(query);
    if (!matchExpression || chunks.length === 0) return [];

    abortIfNeeded(signal);
    await this.ensureMemoryTempStore();
    nextTemporaryTableId += 1;
    const table = `rag_fts_query_${nextTemporaryTableId}`;
    const matches: LocalFullTextSearchMatch[] = [];

    await this.database.transaction(async transaction => {
      // The table name is generated from a monotonic counter; only data values use SQL parameters.
      await transaction.execute(
        `CREATE VIRTUAL TABLE temp.${table} USING fts5(chunk_id UNINDEXED, body, tokenize = 'unicode61')`,
      );
      try {
        for (const chunk of chunks) {
          abortIfNeeded(signal);
          await transaction.execute(
            `INSERT INTO temp.${table} (chunk_id, body) VALUES (?, ?)`,
            [chunk.id, chunk.text],
          );
        }
        abortIfNeeded(signal);
        const result = await transaction.execute(
          `SELECT chunk_id FROM temp.${table} WHERE body MATCH ? ORDER BY bm25(${table}) ASC, chunk_id ASC LIMIT ?`,
          [matchExpression, limit],
        );
        for (const row of result.rows) {
          if (typeof row.chunk_id === 'string')
            matches.push({ chunkId: row.chunk_id });
        }
      } finally {
        await transaction.execute(`DROP TABLE IF EXISTS temp.${table}`);
      }
    });
    return matches;
  }

  private async ensureMemoryTempStore(): Promise<void> {
    if (!this.tempStoreReady) {
      this.tempStoreReady = this.database
        .execute('PRAGMA temp_store = MEMORY')
        .then(() => undefined)
        .catch(error => {
          this.tempStoreReady = null;
          throw error;
        });
    }
    await this.tempStoreReady;
  }
}
