import { runMigrations, createRecordRepository } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../../healthEvidence/localEvidenceTestSupport';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../../storage/secureDatabase';
import { seedMemoryHistory } from '../../../e2e/memoryHistorySeed';
import { selectTestRoute } from '../../../e2e/testRoute';
jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  openLocalStorage: jest.fn(),
}));
it('admits only the named native scenarios', () => {
  expect(selectTestRoute({ OROT_TEST_SCENARIO: 'memory-history' })).toBe(
    'memory-history',
  );
  expect(() =>
    selectTestRoute({ OROT_TEST_SCENARIO: 'memory-history-other' }),
  ).toThrow();
});
it('seeds once, preserves corrections and does not resurrect deleted originals after a fresh call', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  await runMigrations(database);
  const storage = createRecordRepository(database);
  jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(database);
  jest.mocked(openLocalStorage).mockResolvedValue(storage);
  try {
    await seedMemoryHistory('known');
    await seedMemoryHistory('known');
    const original = (await storage.manualHistory.list())[0];
    expect(await storage.manualHistory.list()).toHaveLength(1);
    expect(original.effectiveDate).toEqual({ status: 'unknown' });
    const corrected = await storage.manualHistory.correct(original.id, {
      kind: 'note',
      title: 'Synthetic correction',
      details: 'Synthetic retained details',
      effectiveDate: { status: 'unknown' },
    });
    await seedMemoryHistory('known');
    expect((await storage.manualHistory.list())[0].id).toBe(corrected.id);
    expect(await storage.manualHistory.history(corrected.id)).toHaveLength(2);
    await storage.manualHistory.delete(corrected.id);
    await seedMemoryHistory('known');
    expect(await storage.manualHistory.list()).toEqual([]);
    await expect(seedMemoryHistory('unapproved')).rejects.toThrow(
      'Unsupported memory fixture',
    );
  } finally {
    close();
  }
});

it('rolls back the original when its once marker cannot be committed', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  await runMigrations(database);
  const storage = createRecordRepository(database);
  jest.mocked(openLocalStorage).mockResolvedValue(storage);
  jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue({
    execute: (sql, parameters) => database.execute(sql, parameters),
    transaction: operation =>
      database.transaction(transaction =>
        operation({
          ...transaction,
          execute: (sql, parameters) =>
            sql.startsWith('INSERT INTO memory_native_fixture_seed')
              ? Promise.reject(new Error('Synthetic marker failure'))
              : transaction.execute(sql, parameters),
        }),
      ),
  });
  try {
    await expect(seedMemoryHistory('draft')).rejects.toThrow(
      'Synthetic marker failure',
    );
    expect(await storage.manualHistory.list()).toEqual([]);
    const markers = await database.execute(
      'SELECT name FROM memory_native_fixture_seed',
    );
    expect(markers.rows).toEqual([]);
  } finally {
    close();
  }
});
