import { NativeModules } from 'react-native';
import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  getCipherVersion,
  openLocalAgentMemoryDatabase,
} from '../src/storage/secureDatabase';
import { openDailyReportPersistence } from '../e2e/dailyReportPersistenceFixture';

jest.mock('../src/storage/secureDatabase', () => ({
  getCipherVersion: jest.fn(),
  openLocalAgentMemoryDatabase: jest.fn(),
}));

test('seeds once and reads the same saved artifact without reseeding', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    jest.mocked(getCipherVersion).mockResolvedValue('synthetic-cipher');
    jest
      .mocked(openLocalAgentMemoryDatabase)
      .mockResolvedValue(connection.database);
    let process = 0;
    NativeModules.OrotTestControl = {
      speechSnapshot: async () => ({ processInstance: `process-${++process}` }),
    };
    await expect(openDailyReportPersistence('read')).rejects.toThrow(
      'Saved synthetic report is unavailable',
    );
    const seeded = await openDailyReportPersistence('seed');
    const read = await openDailyReportPersistence('read');
    expect(read.saved).toEqual(seeded.saved);
    expect(read.processInstance).not.toEqual(seeded.processInstance);
    expect(read.saved).toMatchObject({
      status: 'saved',
      runId: 'synthetic-report',
      revision: 1,
    });
    await expect(openDailyReportPersistence('seed')).rejects.toThrow(
      'empty report identity',
    );
  } finally {
    connection.close();
  }
});
