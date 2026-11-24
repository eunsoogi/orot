import { NativeModules } from 'react-native';
import { runMigrations, type SqlDatabase } from '@orot/storage';
import { openOpSqliteWorker } from '../../../test-support/opSqliteWorkerFixture';
import {
  chunk,
  installFingerprint,
} from '../../storage/testSupport/vectorStore';
import { createLocalE5RagService } from '../localE5RagService';

jest.mock('../localE5NativeBackend', () => ({ localE5NativeBackend: {} }));
jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
}));

const source = (id: string) => `source-${id}`;
const page = ['a', 'b', 'c'].map(id => chunk(id, source(id)));
const day = '2026-10-01';
const options = {
  ranking: {
    lexicalWeight: 2,
    vectorWeight: 1,
    rrfConstant: 0,
    candidateLimit: 2,
  },
};
const probes = (sql: string) =>
  sql.startsWith('SELECT COUNT(*) AS ready FROM main.sqlite_master');
const beginsSetup = (sql: string) =>
  sql.startsWith('CREATE TABLE IF NOT EXISTS rag_embedding_models');

function gate() {
  let open!: () => void;
  const waiting = new Promise<void>(done => {
    open = done;
  });
  return { waiting, open };
}

async function openOwned(ids: readonly string[]) {
  const owner = openOpSqliteWorker(':memory:', false);
  const sql: string[] = [];
  const starts: number[] = [];
  let admitted = 0;
  let queued: (() => void) | undefined;
  const database: SqlDatabase = {
    execute(statement, values) {
      sql.push(statement);
      return owner.database.execute(statement, values);
    },
    transaction(operation) {
      const index = ++admitted;
      queued?.();
      return owner.database.transaction(tx => {
        starts.push(index);
        return operation({
          ...tx,
          execute(statement, values) {
            sql.push(statement);
            return tx.execute(statement, values);
          },
        });
      });
    },
  };
  try {
    await runMigrations(database);
    for (const id of ids) {
      await database.execute(
        'INSERT INTO source_records (id, effective_at, recorded_at, ingested_at, payload_json) VALUES (?, ?, ?, ?, ?)',
        [source(id), day, day, day, JSON.stringify({ id: source(id) })],
      );
    }
    const embed = jest.fn(async (texts: readonly string[]) =>
      texts.map(() => Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0))),
    );
    const rag = createLocalE5RagService(database, {
      async prepare() {},
      embedBatch: embed,
      async cancel() {},
    });
    const search = async () =>
      (await rag.search('consultation', page, 2, options)).map(hit => [
        hit.chunk.id,
        hit.lexicalRank,
        hit.vectorRank,
        hit.score,
      ]);
    return {
      owner,
      sql,
      starts,
      search,
      embed,
      rag,
      queued(handler?: () => void) {
        queued = handler;
      },
    };
  } catch (error) {
    await owner.close();
    throw error;
  }
}

beforeEach(installFingerprint);

it('performs one schema proof per protected read without repeating warm setup', async () => {
  const store = await openOwned(['a', 'b', 'c']);
  try {
    await store.rag.index(page);
    const expected = [
      ['a', 1, 1, 3],
      ['b', 2, 2, 1.5],
    ];
    expect(await store.search()).toEqual(expected);
    store.sql.length = 0;
    store.embed.mockClear();
    expect(await store.search()).toEqual(expected);
    expect(store.embed).toHaveBeenCalledTimes(1);
    expect(store.sql.filter(probes)).toHaveLength(2);
    expect(store.sql.filter(beginsSetup)).toHaveLength(1);
  } finally {
    await store.owner.close();
  }
});

it.each(['rollback', 'delete', 'legacy map loss'] as const)(
  'rechecks after a held write settles: %s',
  async outcome => {
    const store = await openOwned(['a', 'b', 'c']);
    const replacement = await openOwned(['c']);
    const releaseDigest = gate();
    const releaseWriter = gate();
    try {
      await store.rag.index(page);
      await replacement.rag.index([page[2]]);
      const enteredDigest = gate();
      const enteredWriter = gate();
      const queuedRead = gate();
      const digest = jest.mocked(NativeModules.OrotConsentFingerprint.sha256);
      const hash = digest.getMockImplementation()!;
      digest.mockImplementationOnce(async (text: string) => {
        enteredDigest.open();
        await releaseDigest.waiting;
        return hash(text);
      });
      const result = store.search();
      await enteredDigest.waiting;
      const writer = store.owner.database.transaction(async tx => {
        if (outcome !== 'legacy map loss')
          await tx.execute('DELETE FROM source_records WHERE id = ?', [
            source('a'),
          ]);
        if (outcome !== 'delete')
          await tx.execute('DROP TABLE rag_embedding_sources');
        enteredWriter.open();
        await releaseWriter.waiting;
        if (outcome === 'rollback') throw new Error('synthetic rollback');
      });
      const settled = writer.then(
        () => 'commit',
        (error: Error) => {
          expect(error.message).toBe('synthetic rollback');
          return 'rollback';
        },
      );
      await enteredWriter.waiting;
      const started = store.starts.length;
      store.queued(queuedRead.open);
      releaseDigest.open();
      await queuedRead.waiting;
      expect(await replacement.search()).toEqual([['c', 1, 1, 3]]);
      expect(store.starts).toHaveLength(started);
      store.queued();
      releaseWriter.open();
      expect(await settled).toBe(
        outcome === 'rollback' ? 'rollback' : 'commit',
      );
      expect(await result).toEqual(
        outcome === 'rollback'
          ? [
              ['a', 1, 1, 3],
              ['b', 2, 2, 1.5],
            ]
          : outcome === 'delete'
            ? [
                ['b', 2, 1, 2],
                ['c', null, 2, 0.5],
              ]
            : [
                ['a', 1, null, 2],
                ['b', 2, null, 1],
              ],
      );
      if (outcome === 'legacy map loss') {
        expect(
          (
            await store.owner.database.execute(
              'SELECT chunk_id FROM rag_embeddings',
            )
          ).rows,
        ).toEqual([]);
      }
      expect(await replacement.search()).toEqual([['c', 1, 1, 3]]);
    } finally {
      releaseDigest.open();
      releaseWriter.open();
      await Promise.all([store.owner.close(), replacement.owner.close()]);
    }
  },
);

it('uses stock setup when a same-named index has the wrong definition', async () => {
  const store = await openOwned(['a', 'b', 'c']);
  try {
    await store.rag.index(page);
    await store.owner.database.transaction(async tx => {
      await tx.execute('DROP INDEX rag_embedding_sources_source_idx');
      await tx.execute(
        'CREATE INDEX rag_embedding_sources_source_idx ON rag_embedding_sources (chunk_id, source_record_id)',
      );
    });
    store.sql.length = 0;
    expect(await store.search()).toEqual([
      ['a', 1, 1, 3],
      ['b', 2, 2, 1.5],
    ]);
    expect(store.sql.filter(probes)).toHaveLength(2);
    expect(store.sql.filter(beginsSetup)).toHaveLength(4);
  } finally {
    await store.owner.close();
  }
});
