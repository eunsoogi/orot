jest.mock('@op-engineering/op-sqlite', () => ({
  IOS_LIBRARY_PATH: '',
  isSQLCipher: () => true,
  open: jest.fn(),
}));
import { open } from '@op-engineering/op-sqlite';
import { openSqliteTestDatabase } from '../../../../packages/storage/__tests__/sqliteTestDatabase';
import * as readerModule from '../../src/healthEvidence/healthContext/reader';
import { runHealthContextTestOperation } from '../healthContextTestOperation';

/** Execute the shipping native-test operation with real SQLite; encryption itself is not exercised here. */
test.each(['normal', 'no-reuse', 'mutable-cache', 'ignored-deletion'] as const)(
  'native cache oracle detects %s without requiring object identity',
  async mode => {
    const f = openSqliteTestDatabase(':memory:');
    const closed = jest.fn(() => f.close());
    (open as jest.Mock).mockReturnValue({
      ...f.database,
      execute: (sql: string, params?: never) =>
        sql === 'PRAGMA cipher_version'
          ? Promise.resolve({ rows: [{ cipher_version: 'synthetic-adapter' }] })
          : f.database.execute(sql, params),
      delete: closed,
    });
    const actualFactory = readerModule.createHealthContextReader;
    const factory = jest
      .spyOn(readerModule, 'createHealthContextReader')
      .mockImplementation(database => {
        const actual = actualFactory(database);
        let calls = 0;
        let first: Awaited<ReturnType<typeof actual>>;
        return async (...args) => {
          calls++;
          if (mode === 'no-reuse') return actualFactory(database)(...args);
          if (mode === 'mutable-cache' && (calls === 2 || calls === 3))
            return first;
          if (mode === 'ignored-deletion' && calls === 5) return first;
          const result = await actual(...args);
          if (calls === 1) first = result;
          return result;
        };
      });
    let result: Awaited<ReturnType<typeof runHealthContextTestOperation>>;
    try {
      result = await runHealthContextTestOperation(
        'test-health-context-12345678-1234-1234-1234-123456789abc',
      );
    } finally {
      factory.mockRestore();
    }
    expect(result.cacheReused).toBe(
      mode === 'normal' || mode === 'ignored-deletion',
    );
    expect(result.deletionInvalidated).toBe(mode !== 'ignored-deletion');
    expect(result.pressureSamples).toBe(6);
    expect(result.exactBoundarySums).toEqual([2, 4]);
    expect(closed).toHaveBeenCalledTimes(1);
  },
);
