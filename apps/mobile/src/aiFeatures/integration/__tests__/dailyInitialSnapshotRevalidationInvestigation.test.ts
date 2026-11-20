import { readDailyReportSnapshot } from '../../../healthEvidence/healthContext/dailyReportSnapshot';
import { createDailyReportCalendarWindow } from '../../../healthEvidence/healthContext/dailyReportWindow';
import { createRecordRepository } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  prepareReportDatabase,
  reportProvider,
  reportService,
  reportObservation,
  reportRequest,
} from '../testSupport/dailyReportFailureStageFixtures';

// Synthetic consent-boundary mutation only. No real remote provider or credentials.
test.each(['unchanged', 'unrelated next day', 'included edit'] as const)(
  'initial report snapshot revalidation: %s',
  async change => {
    const connection = openSqliteTestDatabase(':memory:');
    try {
      await prepareReportDatabase(connection.database);
      const repository = createRecordRepository(connection.database);
      const calendar = createDailyReportCalendarWindow({
        localDate: '2035-01-01',
        timeZone: 'UTC',
        requestedAt: '2035-01-01T12:00:00Z',
      });
      if (calendar.status !== 'ready')
        throw new Error('Invalid synthetic calendar');
      const before = await readDailyReportSnapshot(
        connection.database,
        calendar.context,
        {},
      );
      const provider = reportProvider();
      const generate = jest.spyOn(provider, 'generate');
      const service = reportService(connection.database, provider, {
        remoteProcessing: true,
        authorize: async () => {
          if (change === 'unrelated next day')
            await repository.put('health_observation', {
              ...reportObservation,
              id: 'synthetic-next-day',
              effectiveAt: '2035-01-02T01:00:00Z',
              recordedAt: '2035-01-02T01:00:00Z',
              ingestedAt: '2035-01-02T01:00:00Z',
            });
          if (change === 'included edit')
            await repository.put('health_observation', {
              ...reportObservation,
              value: { kind: 'quantity', amount: 90, unit: 'count/min' },
            });
          return 'authorized';
        },
      });
      const result = await service(reportRequest());
      if (change === 'unrelated next day') {
        const after = await readDailyReportSnapshot(
          connection.database,
          calendar.context,
          {},
        );
        expect(after.values).toEqual(before.values);
        expect(after.lineage).toEqual(before.lineage);
        expect(after.sourceSnapshot.records).toEqual(
          before.sourceSnapshot.records,
        );
        expect(after.sourceSnapshot.coverage).toEqual(
          before.sourceSnapshot.coverage,
        );
        expect(after.sourceSnapshot.deletionGeneration).toBe(
          before.sourceSnapshot.deletionGeneration,
        );
        expect(after.sourceSnapshot.mutationGeneration).toBe(
          before.sourceSnapshot.mutationGeneration + 1,
        );
      }
      expect(result.status).toBe('completed');
      expect(generate).toHaveBeenCalledTimes(1);
      if (change === 'included edit') {
        const wire = JSON.stringify(generate.mock.calls[0]![0]);
        expect(wire).toContain('90');
        if (result.status === 'completed')
          expect(result.report.observations[0]?.text).toContain('90');
      }
    } finally {
      connection.close();
    }
  },
);
