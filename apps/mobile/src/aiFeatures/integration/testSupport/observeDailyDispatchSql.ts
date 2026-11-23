import type { SqlDatabase } from '@orot/storage';

export function observeDailyDispatchSql(
  database: SqlDatabase,
  after: () => void,
): SqlDatabase {
  return {
    execute: (sql, params) => database.execute(sql, params),
    transaction: work =>
      database.transaction(tx =>
        work({
          ...tx,
          async execute(sql, params) {
            const result = await tx.execute(sql, params);
            if (
              /SELECT c\.phase, r\.status/u.test(sql) &&
              result.rows[0]?.phase === 'dispatch_possible'
            )
              after();
            return result;
          },
        }),
      ),
  };
}

export function mockDailyDeviceZone(zone: () => string) {
  const actualDateTimeFormat = Intl.DateTimeFormat;
  return jest.spyOn(Intl, 'DateTimeFormat').mockImplementation((...args) => {
    const impl = new actualDateTimeFormat(...args);
    if (!args.length) {
      const exact = impl.resolvedOptions.bind(impl);
      impl.resolvedOptions = () => ({ ...exact(), timeZone: zone() });
    }
    return impl;
  });
}
