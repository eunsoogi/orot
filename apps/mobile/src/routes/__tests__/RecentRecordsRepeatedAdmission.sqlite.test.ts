import {
  createRecordRepository,
  runMigrations,
  type SqlDatabase,
} from '@orot/storage';
import { readProtectedRecentMaterialPage } from '../../generatedReports/certifiedRecentMaterialPage';
import { SqlCipherAgentMemoryStorage } from '../../storage/agentMemoryStorage';
import { readCommittedRecentSourcePage } from '../../storage/committedRecentSourcePage';
import { guardedNativeDatabase } from '../../storage/protectedReadEpoch';
import { openInterleavableRecentSourceDatabase } from '../../storage/testSupport/interleavableRecentSourceDatabase';

const statement = 'UPDATE synthetic_recent_contention SET value=value+1';
const fixtureId = 'synthetic-recent-contention-file';

async function seedAgent(database: SqlDatabase) {
  await new SqlCipherAgentMemoryStorage(database).append({
    id: 'synthetic-agent-admission',
    text: 'Synthetic retained memory',
    vector: new Float32Array([1]),
    tags: [],
    entities: [],
    importance: 0.5,
    createdAt: Date.parse('2026-11-24T01:00:00Z'),
    reinforcements: 0,
    meta: {
      memoryKey: 'synthetic-agent-admission',
      kind: 'preference',
      provenance: { sourceIds: [], reviewState: 'user_confirmed' },
    },
  });
}

test.each(['agent', 'media', 'native refusal'] as const)(
  'only a proved same-owner first page survives repeated writers arriving during %s re-admission',
  async mode => {
    const f = openInterleavableRecentSourceDatabase();
    let release: (() => void) | undefined;
    const writes: Promise<unknown>[] = [];
    const agent = mode !== 'media';
    const database: SqlDatabase = guardedNativeDatabase({
      async execute(query, parameters) {
        if (query === statement)
          await new Promise<void>(resolve => {
            release = resolve;
            if (agent) setImmediate(resolve);
          });
        return f.database.execute(query, parameters);
      },
      async transaction(operation) {
        try {
          await f.database.transaction(operation);
        } finally {
          if (!agent) release?.();
        }
      },
    });
    try {
      await runMigrations(f.database);
      await f.database.execute(
        'CREATE TABLE synthetic_recent_contention(value INTEGER)',
      );
      await f.database.execute(
        'INSERT INTO synthetic_recent_contention VALUES(0)',
      );
      await seedAgent(f.database);
      await createRecordRepository(f.database).put('source_record', {
        id: fixtureId,
        sourceKind: 'medical_document',
        ingestedAt: '2026-11-25T01:00:00Z',
        title: 'Synthetic protected file',
        provenance: { origin: 'imported', sourceRecordIds: [] },
        reviewState: { status: 'unreviewed' },
      });
      const signal = new AbortController().signal;
      const newWriter = () => writes.push(database.execute(statement));
      const current = () => true;
      let admitted = 0;
      const canRetry = jest.fn(async () => {
        // A write becomes pending during the positive native check, after
        // awaitIndependentReadSettlement but before the replacement witness.
        if (admitted++ < 3) newWriter();
        return mode !== 'native refusal';
      });
      newWriter();
      if (agent) {
        const page = readProtectedRecentMaterialPage(
          { database, isCurrent: current },
          undefined,
          { signal, isCurrent: current, canRetry },
        );
        if (mode === 'native refusal') {
          await expect(page).rejects.toThrow();
          expect(canRetry).toHaveBeenCalledTimes(1);
        } else {
          const result = await page;
          try {
            expect(result.kind).toBe('complete');
            if (result.kind === 'complete')
              expect(result.rows.map(row => row.key)).toContain(
                'memory:agent:synthetic-agent-admission',
              );
          } finally {
            result.witness.dispose();
          }
        }
      } else {
        expect(
          (
            await readCommittedRecentSourcePage(
              database,
              undefined,
              signal,
              canRetry,
            )
          ).map(row => row.id),
        ).toEqual([fixtureId]);
      }
      if (mode !== 'native refusal') expect(canRetry).toHaveBeenCalledTimes(4);
      await Promise.all(writes);
    } finally {
      release?.();
      await Promise.allSettled(writes);
      f.close();
    }
  },
);
