import { STORAGE_TABLES } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createDailyReportService } from '../dailyReportService';
import {
  prepareReportDatabase,
  reportProvider,
  reportRequest,
  selectedReportProvider,
} from '../testSupport/dailyReportFailureStageFixtures';

test('blocks legitimate Read until projection and provider output without counting each nonempty table separately', async () => {
  const fixture = openSqliteTestDatabase(':memory:');
  let release!: () => void;
  const held = new Promise<void>(resolve => (release = resolve));
  let entered!: () => void;
  const blocked = new Promise<void>(resolve => (entered = resolve));
  let providerRelease!: () => void;
  let providerEntered!: () => void;
  const providerHeld = new Promise<void>(
    resolve => (providerRelease = resolve),
  );
  const providerBlocked = new Promise<void>(
    resolve => (providerEntered = resolve),
  );
  let result: Promise<unknown> | undefined;
  try {
    await prepareReportDatabase(fixture.database);
    const model = reportProvider();
    const complete = model.generate.bind(model);
    const generate = jest
      .spyOn(model, 'generate')
      .mockImplementationOnce(async (...args) => {
        providerEntered();
        await providerHeld;
        return complete(...args);
      });
    const authorize = jest.fn(async () => 'authorized' as const);
    const onProviderReceipt = jest.fn();
    let identifierRoundTrips = 0;
    const run = createDailyReportService({
      database: {
        ...fixture.database,
        async execute(sql, params) {
          // The production projection uses these substring probes before dispatch.
          if (
            /instr\(\?, id\)|AS exact_identifier_candidates|^SELECT count\(\*\) AS total FROM/.test(
              sql,
            )
          ) {
            identifierRoundTrips++;
            if (identifierRoundTrips === 1) {
              entered();
              await held;
            }
          }
          return fixture.database.execute(sql, params);
        },
      },
      now: () => '2035-01-01T12:00:00Z',
      createRunId: () => 'pre-read-redaction',
      resolveSelected: async () => selectedReportProvider(model, true),
      consent: { authorize },
    });
    result = run({
      ...reportRequest(),
      scope: { sourceIds: ['synthetic-report-source'] },
      observer: { onProviderReceipt },
    });
    const checkStage = (stage: Promise<void>) =>
      Promise.race([
        stage,
        result!.then(() => {
          throw new Error('Daily Report ended before the held boundary.');
        }),
      ]);
    await checkStage(blocked);
    expect(generate).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
    expect(onProviderReceipt).not.toHaveBeenCalled();
    release();
    await checkStage(providerBlocked);
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(onProviderReceipt).not.toHaveBeenCalled();
    providerRelease();
    await expect(result).resolves.toMatchObject({ status: 'completed' });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(onProviderReceipt).toHaveBeenCalledWith('response_started');
    expect(identifierRoundTrips).toBe(Object.keys(STORAGE_TABLES).length + 1);
  } finally {
    release();
    providerRelease();
    await result;
    fixture.close();
  }
});
