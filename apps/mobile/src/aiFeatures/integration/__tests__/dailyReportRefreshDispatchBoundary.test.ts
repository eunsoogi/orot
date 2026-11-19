import { createRecordRepository } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  prepareReportDatabase,
  reportObservation,
  reportProvider,
  reportService,
  reportRequest,
} from '../testSupport/dailyReportFailureStageFixtures';

// A proof-only refresh must never reinterpret changed model input as current.
// These are SQLite + synthetic model boundaries, not remote model evidence.
test.each([
  'outside insert',
  'included edit',
  'outside delete',
  'cancel',
] as const)(
  'after dispatch: %s does not repeat the model or persist invalid evidence',
  async change => {
    const f = openSqliteTestDatabase(':memory:');
    try {
      await prepareReportDatabase(f.database);
      const repository = createRecordRepository(f.database);
      const outside = {
        ...reportObservation,
        id: 'outside',
        effectiveAt: '2035-01-02T01:00:00Z',
        recordedAt: '2035-01-02T01:00:00Z',
        ingestedAt: '2035-01-02T01:00:00Z',
      };
      if (change === 'outside delete')
        await repository.put('health_observation', outside);
      const controller = new AbortController();
      const provider = reportProvider();
      const original = provider.generate.bind(provider);
      const generate = jest
        .spyOn(provider, 'generate')
        .mockImplementation(async (...args) => {
          const result = await original(...args);
          if (change === 'cancel') controller.abort();
          else if (change === 'outside delete')
            await repository.delete('health_observation', outside.id);
          else
            await repository.put(
              'health_observation',
              change === 'outside insert'
                ? outside
                : {
                    ...reportObservation,
                    value: { kind: 'quantity', amount: 99, unit: 'count/min' },
                  },
            );
          return result;
        });
      const result = await reportService(
        f.database,
        provider,
      )(reportRequest(controller.signal));
      expect(generate).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(
        change === 'outside insert' ? 'completed' : 'failed',
      );
      const heads = (
        await f.database.execute('SELECT identity_key FROM daily_report_heads')
      ).rows;
      expect(heads).toHaveLength(change === 'outside insert' ? 1 : 0);
      if (change === 'included edit') {
        const row = await repository.get(
          'health_observation',
          reportObservation.id,
        );
        expect(row?.value).toEqual({
          kind: 'quantity',
          amount: 99,
          unit: 'count/min',
        });
      }
      if (change === 'outside delete')
        expect(
          await repository.get('health_observation', outside.id),
        ).toBeNull();
    } finally {
      f.close();
    }
  },
);

test('a second pre-dispatch correction is bounded and never sends stale facts', async () => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    await prepareReportDatabase(f.database);
    const repository = createRecordRepository(f.database);
    const provider = reportProvider();
    const generate = jest.spyOn(provider, 'generate');
    let decisions = 0;
    const result = await reportService(f.database, provider, {
      remoteProcessing: true,
      authorize: async () => {
        decisions++;
        await repository.put('health_observation', {
          ...reportObservation,
          value: {
            kind: 'quantity',
            amount: 80 + decisions,
            unit: 'count/min',
          },
        });
        return 'authorized';
      },
    })(reportRequest());
    expect(decisions).toBe(2);
    expect(generate).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'failed',
      code: 'source_revision_changed',
    });
    expect(
      (await f.database.execute('SELECT identity_key FROM daily_report_heads'))
        .rows,
    ).toEqual([]);
  } finally {
    f.close();
  }
});
