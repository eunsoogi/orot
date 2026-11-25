import { STORAGE_TABLES } from '../src/contracts';
import {
  periodRecordKinds,
  periodRecordingIndex,
  periodRemovalIndexDefinitions,
  readTrustedOrderedPeriodIndexes,
} from '../src/periodProvenanceIndexes';
import {
  listTypedSourceDeletionReferences,
  readSourceDeletionSnapshot as readOwnedSnapshot,
} from '../src/sourceDeletionReferences';
import type { SqlDatabase } from '../src/sql';
import { openSqliteTestDatabase } from './sqliteTestDatabase';
const indexed = { useIndexedHealthCandidates: true } as const;
const snapshot = ([db, id, observe]: Parameters<typeof readOwnedSnapshot>) =>
  readOwnedSnapshot(db, id, observe, indexed);
const root = 'root-recording';
const from = '2026-11-15T00:00:00.000Z';
async function fixture(rowless?: string) {
  const { database, close } = openSqliteTestDatabase(':memory:');
  for (const { table } of Object.values(STORAGE_TABLES)) {
    await database.execute(
      `CREATE TABLE ${table}(id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, effective_at TEXT)${table === rowless ? ' WITHOUT ROWID' : ''}`,
    );
  }
  await database.execute(periodRecordingIndex.sql);
  await database.execute(
    "CREATE UNIQUE INDEX transcript_segments_revision_idx ON transcript_segments (json_extract(payload_json, '$.transcriptId'),json_extract(payload_json,'$.revision'))",
  );
  const put = (table: string, id: string, value: unknown) =>
    database.execute(`INSERT INTO ${table} (id,payload_json,effective_at) VALUES (?,?,?)`, [
      id,
      JSON.stringify(value),
      from,
    ]);
  const attachIndexes = async (table: string) => {
    for (const index of periodRemovalIndexDefinitions(table)) await database.execute(index.sql);
  };
  const observed = (queries: string[]): SqlDatabase => ({
    ...database,
    transaction(work) {
      return database.transaction((tx) =>
        work({
          ...tx,
          execute(sql, params) {
            queries.push(sql);
            return tx.execute(sql, params);
          },
        }),
      );
    },
  });
  return { database, close, attachIndexes, put, observed };
}

test('source snapshot retains exactly ordered identity and legacy shapes for all verified families', async () => {
  const f = await fixture();
  try {
    await f.put('transcript_segments', 'seg-z', {
      recordingSourceId: root,
      transcriptId: 'family-z',
      segmentOrdinal: 1,
      revision: 1,
    });
    await f.put('transcript_segments', 'seg-a', {
      recordingSourceId: root,
      transcriptId: 'family-a',
      segmentOrdinal: 0,
      revision: 1,
    });
    await f.put('transcript_segments', '42', {
      recordingSourceId: root,
      transcriptId: 'family-number-id',
      segmentOrdinal: 2,
      revision: 1,
    });
    await f.put('transcript_segments', 'seg-other', {
      recordingSourceId: 'other-recording',
      transcriptId: 'other-family',
      segmentOrdinal: 0,
      revision: 1,
    });
    await f.put('evidence_spans', 'span', { sourceRecordId: root });
    await f.put('visit_questions', 'question', { evidenceSpanIds: ['span'] });
    await f.put('visit_question_records', 'visit-record', { questionId: 'question' });
    for (const table of Object.keys(periodRecordKinds)) {
      for (const [suffix, value] of [
        ['z-direct', [root]],
        ['a-family', ['family-z']],
        ['b-segment', ['seg-a']],
        ['d-multiple', ['seg-other', 'seg-z']],
        ['c-legacy-scalar', 'family-a'],
        ['r-legacy-object', { stored: 'seg-a' }],
        ['n-number-text', ['42']],
        ['n-number', [42]],
        ['x-null', null],
        ['y-absent', undefined],
        ['x-empty', []],
        ['foreign', ['other-family']],
        ['wrong-case', ['SEG-Z']],
      ] as const)
        await f.put(table, `${table}-${suffix}`, { provenance: { sourceRecordIds: value } });
      await f.attachIndexes(table);
    }
    const stock = await listTypedSourceDeletionReferences(f.database, root);
    const calls: string[] = [];
    const legacyCalls: string[] = [];
    expect(await readOwnedSnapshot(f.observed(legacyCalls), root)).toEqual(stock);
    expect(legacyCalls.filter((sql) => /sqlite_master|INDEXED BY/.test(sql))).toEqual([]);
    const optimized = await snapshot([f.observed(calls), root]);
    expect(calls.filter((sql) => sql.includes('sqlite_master'))).toHaveLength(1);
    expect(optimized).toEqual(stock);
    expect(optimized.slice(0, 5)).toEqual([
      { kind: 'source_record', id: root },
      { kind: 'evidence_span', id: 'span' },
      { kind: 'transcript_segment', id: 'seg-a' },
      { kind: 'transcript_family', id: 'family-a' },
      { kind: 'transcript_segment', id: 'seg-z' },
    ]);
    expect(optimized).toContainEqual({ kind: 'visit_question_record', id: 'visit-record' });
    expect(optimized).not.toContainEqual({
      kind: 'health_observation',
      id: 'health_observations-foreign',
    });
    expect(calls.filter((sql) => sql.includes('ORDER BY position'))).toHaveLength(5);
    expect(calls.every((sql) => sql.startsWith('SELECT'))).toBe(true);
  } finally {
    f.close();
  }
});

test('absent, stale, wrong-owner and WITHOUT ROWID families return the unchanged stock read', async () => {
  const f = await fixture('dose_events');
  try {
    for (const table of Object.keys(periodRecordKinds))
      await f.put(table, `${table}-present`, { provenance: { sourceRecordIds: [root] } });
    const stock = await listTypedSourceDeletionReferences(f.database, root);
    const print = async (expected: readonly string[]) => {
      const calls: string[] = [];
      expect(await snapshot([f.observed(calls), root])).toEqual(stock);
      const indexed = calls.filter((sql) => sql.includes('ORDER BY position'));
      expect(indexed).toHaveLength(expected.length);
      for (const table of expected)
        expect(indexed.some((sql) => sql.includes(`CROSS JOIN ${table} h`))).toBe(true);
    };
    await print([]);

    await f.attachIndexes('dose_events');
    await f.attachIndexes('health_observations');
    const [symptomIndex] = periodRemovalIndexDefinitions('symptom_entries');
    if (!symptomIndex) throw new Error('Synthetic index missing');
    await f.database.execute(`CREATE INDEX ${symptomIndex.name} ON health_observations(id)`);
    expect([...(await readTrustedOrderedPeriodIndexes(f.database))]).toEqual([
      'health_observations',
    ]);
    await print(['health_observations']);
    const [healthIndex] = periodRemovalIndexDefinitions('health_observations');
    if (!healthIndex) throw new Error('Synthetic index missing');
    await f.database.execute(`DROP INDEX ${healthIndex.name}`);
    await f.database.execute(`CREATE INDEX ${healthIndex.name} ON health_observations(id)`);
    await print([]);
    await f.database.execute(`DROP INDEX ${healthIndex.name}`);
    await f.database.execute(healthIndex.sql);
    await print(['health_observations']);
    await f.database.execute(`DROP INDEX ${periodRecordingIndex.name}`);
    await print([]);
  } finally {
    f.close();
  }
});

test('malformed legacy row and failed owner settlement cannot return partial scoped references', async () => {
  const f = await fixture();
  try {
    await f.database.execute(
      'INSERT INTO health_observations (id,payload_json,effective_at) VALUES (?,?,?)',
      ['malformed', '{broken', from],
    );
    await expect(listTypedSourceDeletionReferences(f.database, root)).rejects.toThrow();
    await expect(snapshot([f.database, root])).rejects.toThrow();
    await f.database.execute('DELETE FROM health_observations');
    await f.attachIndexes('health_observations');
    await f.put('health_observations', 'matched', { provenance: { sourceRecordIds: [root] } });
    const cause = new Error('rejected original owner settlement');
    const failed: SqlDatabase = {
      ...f.database,
      transaction: (work) =>
        f.database.transaction(async (tx) => {
          await work(tx);
          throw cause;
        }),
    };
    const phases: string[] = [];
    await expect(
      snapshot([failed, root, (stage, event) => phases.push(stage + ':' + event)]),
    ).rejects.toBe(cause);
    expect(phases).toEqual([
      'admission:begin',
      'admission:success',
      'body:begin',
      'body:success',
      'settlement:begin',
      'settlement:failure',
    ]);
    expect(await snapshot([f.database, root])).toContainEqual({
      kind: 'health_observation',
      id: 'matched',
    });
  } finally {
    f.close();
  }
});

test('a queued source read proves the current owner schema after an earlier commit', async () => {
  const f = await fixture();
  try {
    await f.attachIndexes('health_observations');
    await f.put('health_observations', 'matching', { provenance: { sourceRecordIds: [root] } });
    const [index] = periodRemovalIndexDefinitions('health_observations');
    if (!index) throw new Error('Synthetic index missing');
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const earlier = f.database.transaction(async (tx) => {
      await tx.execute(`DROP INDEX ${index.name}`);
      enter();
      await held;
    });
    await entered;
    const calls: string[] = [];
    const reading = snapshot([f.observed(calls), root]);
    try {
      expect(calls).toEqual([]);
      release();
      await earlier;
      expect(await reading).toContainEqual({ kind: 'health_observation', id: 'matching' });
      expect(calls.some((sql) => sql.includes('ORDER BY position'))).toBe(false);
    } finally {
      release();
      await Promise.allSettled([reading, earlier]);
    }
  } finally {
    f.close();
  }
});
