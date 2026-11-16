import { NativeModules } from 'react-native';
import type { SqlDatabase } from '@orot/storage';
import { SqlCipherRagEmbeddingStorage } from '../ragEmbeddingStorage';
import {
  chunk,
  document,
  installFingerprint,
  model,
  openDatabase,
  store,
} from '../testSupport/vectorStore';

/** Real serialized SQLite plus a delayed synthetic hash proves ownership, not device latency. */
test.each([
  'unchanged',
  'delete',
  'source-delete',
  'revise',
  'legacy-vector',
] as const)(
  'releases the transaction while hashing and rejects %s changes at the final fence',
  async change => {
    installFingerprint();
    const opened = await openDatabase();
    let active = 0;
    const database: SqlDatabase = {
      execute: (...args) => opened.database.execute(...args),
      transaction: operation =>
        opened.database.transaction(async transaction => {
          active += 1;
          try {
            await operation(transaction);
          } finally {
            active -= 1;
          }
        }),
    };
    try {
      const { vectors } = store(database);
      const original = chunk();
      await vectors.addDocuments([document(original)]);
      const hash = NativeModules.OrotConsentFingerprint.sha256 as jest.Mock;
      const originalHash = hash.getMockImplementation()!;
      let release!: () => void;
      let started!: () => void;
      const hashing = new Promise<void>(resolve => {
        started = resolve;
      });
      hash.mockImplementationOnce(async (value: string) => {
        started();
        await new Promise<void>(resolve => {
          release = resolve;
        });
        return originalHash(value);
      });
      const query = [1, 0];
      const result = vectors.similaritySearchVectorWithScore(query, 1, {
        candidates: [original],
      });
      await hashing;
      expect(active).toBe(0);
      query[0] = 0;
      query[1] = 1;
      // This unrelated transaction must finish before the hash is released, not wait behind it.
      await database.transaction(async transaction => {
        await transaction.execute('SELECT 1');
      });
      if (change === 'delete') await vectors.delete({ ids: [original.id] });
      if (change === 'source-delete')
        await database.execute('DELETE FROM source_records WHERE id = ?', [
          'source-a',
        ]);
      if (change === 'revise')
        await vectors.addDocuments([
          document({ ...original, text: 'Synthetic corrected text' }),
        ]);
      if (change === 'legacy-vector')
        await new SqlCipherRagEmbeddingStorage(database).upsertBatch(model, [
          {
            chunkId: original.id,
            sourceRecordIds: ['source-a'],
            vector: [0, 1],
          },
        ]);
      release();
      expect(await result).toEqual(
        change === 'unchanged' ? [[document(original), 1]] : [],
      );
    } finally {
      opened.close();
    }
  },
);
