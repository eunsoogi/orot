import { createRecordRepository } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  prepareReportDatabase,
  reportObservation,
  reportProvider,
  reportService,
  reportRequest,
} from '../testSupport/dailyReportFailureStageFixtures';

test.each(['authorized', 'revoked', 'cancelled', 'deleted remaining'] as const)(
  'fresh readmission retains consent and owner: %s',
  async state => {
    const f = openSqliteTestDatabase(':memory:');
    try {
      await prepareReportDatabase(f.database);
      const repository = createRecordRepository(f.database);
      if (state === 'deleted remaining')
        await repository.put('health_observation', {
          ...reportObservation,
          id: 'remaining',
          value: { kind: 'quantity', amount: 88, unit: 'count/min' },
        });
      const provider = reportProvider();
      const generate = jest.spyOn(provider, 'generate');
      const controller = new AbortController();
      let decisions = 0;
      const service = reportService(f.database, provider, {
        remoteProcessing: true,
        authorize: async () => {
          decisions++;
          if (decisions === 1) {
            if (state === 'deleted remaining')
              await repository.delete(
                'health_observation',
                reportObservation.id,
              );
            else
              await repository.put('health_observation', {
                ...reportObservation,
                value: { kind: 'quantity', amount: 99, unit: 'count/min' },
              });
          }
          if (decisions === 2 && state === 'cancelled') controller.abort();
          return decisions === 2 && state === 'revoked'
            ? 'renewal_required'
            : 'authorized';
        },
      });
      const result = await service(reportRequest(controller.signal));
      expect(decisions).toBe(2);
      if (state === 'revoked' || state === 'cancelled') {
        expect(result).toEqual({
          status: 'failed',
          code: state === 'revoked' ? 'consent_required' : 'cancelled',
        });
        expect(generate).not.toHaveBeenCalled();
        expect(
          (
            await f.database.execute(
              'SELECT identity_key FROM daily_report_heads',
            )
          ).rows,
        ).toEqual([]);
      } else {
        expect(result.status).toBe('completed');
        expect(generate).toHaveBeenCalledTimes(1);
        const payload = JSON.stringify(generate.mock.calls[0]![0]);
        expect(payload).toContain(state === 'deleted remaining' ? '88' : '99');
        expect(payload).not.toContain('72');
        if (result.status === 'completed' && state === 'deleted remaining')
          expect(
            result.context.sourceSnapshot.records.map(item => item.recordId),
          ).toEqual(['remaining']);
      }
    } finally {
      f.close();
    }
  },
);
