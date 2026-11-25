import { runMigrations, type SqlDatabase } from '@orot/storage';
import { NativeModules } from 'react-native';
import { readProtectedRecentMaterialPage } from '../../generatedReports/certifiedRecentMaterialPage';
import { SqlCipherAgentMemoryStorage } from '../../storage/agentMemoryStorage';
import { BoundReadRevisionChanged } from '../../storage/boundReadResultWitness';
import { readCommittedRecentSourcePage } from '../../storage/committedRecentSourcePage';
import { openInterleavableRecentSourceDatabase } from '../../storage/testSupport/interleavableRecentSourceDatabase';
import { guardedNativeDatabase } from '../../storage/protectedReadEpoch';
import { reportRecentSourceFailure } from '../recentSourceFailureDiagnostic';

const prior = NativeModules.OrotProviderDiagnostics;
const report = jest.fn();
const privateText = 'Synthetic protected source body';
const options = () => ({
  isCurrent: () => true,
  signal: new AbortController().signal,
});

beforeEach(() => {
  report.mockClear();
  NativeModules.OrotProviderDiagnostics = { enabled: true, report };
});
afterEach(() => {
  NativeModules.OrotProviderDiagnostics = prior;
});

async function initializeAgent(
  database: ReturnType<
    typeof openInterleavableRecentSourceDatabase
  >['database'],
) {
  await new SqlCipherAgentMemoryStorage(database).append({
    id: 'synthetic-failure-fixture',
    text: privateText,
    vector: new Float32Array([1]),
    tags: [],
    entities: [],
    importance: 0.5,
    createdAt: Date.parse('2026-11-24T01:00:00Z'),
    reinforcements: 0,
    meta: {
      memoryKey: 'synthetic-failure-fixture',
      kind: 'preference',
      provenance: { sourceIds: [], reviewState: 'user_confirmed' },
    },
  });
}

test.each([
  ['witness', 'unavailable'],
  ['schema', 'unavailable'],
  ['slice', 'failed'],
] as const)(
  'the real private agent reader distinguishes %s failure while returning no rows',
  async (phase, reason) => {
    const f = openInterleavableRecentSourceDatabase();
    try {
      await runMigrations(f.database);
      await initializeAgent(f.database);
      if (phase === 'schema')
        await f.database.execute(
          'DROP INDEX transcript_segments_recent_memory_superseded_idx',
        );
      if (phase === 'slice')
        await f.database.execute('DROP INDEX agent_memory_recent_metadata_idx');
      // A spread connection is the same methods, but not the admitted owner.
      const database = phase === 'witness' ? { ...f.database } : f.database;
      await expect(
        readProtectedRecentMaterialPage(
          { database, isCurrent: () => true },
          undefined,
          options(),
        ),
      ).rejects.toThrow();
      expect(report.mock.calls).toEqual([
        ['storage', 'recent_records_agent_' + phase, reason],
      ]);
      expect(JSON.stringify(report.mock.calls)).not.toContain(privateText);
    } finally {
      f.close();
    }
  },
);

test('media indexed query failure is attributed independently and still rejects', async () => {
  const f = openInterleavableRecentSourceDatabase();
  try {
    await runMigrations(f.database);
    await f.database.execute('DROP INDEX source_records_recent_page_idx');
    await expect(readCommittedRecentSourcePage(f.database)).rejects.toThrow(
      'Committed recent sources are unavailable.',
    );
    expect(report.mock.calls).toEqual([
      ['storage', 'recent_records_media_query', 'failed'],
    ]);
  } finally {
    f.close();
  }
});

test('only fixed dispositions distinguish revision, cancellation and driver text', () => {
  const stop = new AbortController();
  stop.abort();
  reportRecentSourceFailure(
    'recent_records_agent_slice',
    new BoundReadRevisionChanged(),
  );
  reportRecentSourceFailure(
    'recent_records_agent_slice',
    new Error(privateText),
    stop.signal,
  );
  reportRecentSourceFailure(
    'recent_records_agent_slice',
    new Error(privateText),
  );
  expect(report.mock.calls).toEqual([
    ['storage', 'recent_records_agent_slice', 'stale_evidence'],
    ['storage', 'recent_records_agent_slice', 'cancelled'],
    ['storage', 'recent_records_agent_slice', 'failed'],
  ]);
});

test.each(['catalog', 'slice'] as const)(
  'a real SQLite writer between native settlement and React keeps a retryable %s revision failure',
  async phase => {
    const f = openInterleavableRecentSourceDatabase();
    let remaining = phase === 'catalog' ? 1 : 2;
    const database: SqlDatabase = guardedNativeDatabase({
      execute: f.database.execute,
      async transaction(operation) {
        await f.database.transaction(operation);
        if (--remaining === 0)
          await database.execute('UPDATE recent_late_write SET changed=1');
      },
    });
    try {
      await runMigrations(f.database);
      await initializeAgent(f.database);
      await f.database.execute(
        'CREATE TABLE recent_late_write(changed INTEGER)',
      );
      await f.database.execute('INSERT INTO recent_late_write VALUES(0)');
      const lease = { database, isCurrent: () => true };
      await expect(
        readProtectedRecentMaterialPage(lease, undefined, options()),
      ).rejects.toBeInstanceOf(BoundReadRevisionChanged);
      expect(
        (await database.execute('SELECT changed FROM recent_late_write')).rows,
      ).toEqual([{ changed: 1 }]);
      expect(report.mock.calls).toEqual([
        ['storage', 'recent_records_agent_' + phase, 'stale_evidence'],
      ]);
      const fresh = await readProtectedRecentMaterialPage(
        lease,
        undefined,
        options(),
      );
      try {
        expect(fresh.kind).toBe('complete');
        if (fresh.kind === 'complete')
          expect(fresh.rows.map(row => row.key)).toContain(
            'memory:agent:synthetic-failure-fixture',
          );
      } finally {
        fresh.witness.dispose();
      }
    } finally {
      f.close();
    }
  },
);
