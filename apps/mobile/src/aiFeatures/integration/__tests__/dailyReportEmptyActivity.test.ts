import { HealthObservationSchema } from '@orot/domain';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createDailyReportStorage } from '../../../storage/dailyReportStorage';
import { conversationDailyReportText } from '../conversationDailyReportText';
import { dailyReportEmptyActivity } from '../dailyReportEmptyActivity';
import {
  calendarFixture,
  calendarReportService,
  calendarTestObservation,
  calendarTestRequest,
} from '../testSupport/dailyReportCalendarTestFixture';

test.each(['empty', 'recorded', 'restricted', 'failed'] as const)(
  'protected local %s coverage changes only authorized observations',
  async state => {
    const connection = openSqliteTestDatabase(':memory:');
    const native = calendarFixture();
    native.revoke();
    try {
      const { database } = connection;
      await runMigrations(database);
      const repo = createRecordRepository(database);
      await repo.put('health_observation', calendarTestObservation);
      await repo.put(
        'health_observation',
        HealthObservationSchema.parse({
          ...calendarTestObservation,
          id: 'synthetic-steps',
          concept: 'step_count',
          value: { kind: 'quantity', amount: 80, unit: 'count' },
        }),
      );
      if (state === 'recorded')
        await repo.put(
          'health_observation',
          HealthObservationSchema.parse({
            ...calendarTestObservation,
            id: 'synthetic-workout',
            concept: 'workout_duration',
            endedAt: '2035-01-01T01:30:00Z',
            value: { kind: 'quantity', amount: 30, unit: 'min' },
            workout: { activityType: 1, activityName: 'cardio' },
          }),
        );
      if (state === 'failed')
        await database.execute('DROP TABLE health_observations');
      const { run, generate, consent } = calendarReportService(
        database,
        native,
      );
      const request = calendarTestRequest();
      const result = await run({
        ...request,
        scope:
          state === 'restricted'
            ? { sourceIds: [calendarTestObservation.id] }
            : request.scope,
      });
      if (state === 'failed') {
        expect(result).toMatchObject({ status: 'failed' });
        expect(generate).not.toHaveBeenCalled();
        return;
      }
      if (result.status !== 'completed')
        throw new Error(JSON.stringify(result));
      expect(generate.mock.calls[0]![0]).toEqual(
        consent.mock.calls[0]![0].payload,
      );
      const wire = JSON.stringify(generate.mock.calls[0]![0]);
      expect(wire).not.toContain('local_workout_records');
      expect(wire).not.toContain('local_sleep_records');
      expect(wire).not.toContain('source_sync_unknown');
      expect(wire).not.toContain(
        '권한·동기화·기록 범위에 따라 빠질 수 있어요.',
      );
      expect(wire).not.toContain('오늘 아직 활동하지 않았고');
      expect(wire).toContain('do not inspect gaps in records');
      expect(
        result.report.coverage.some(
          item =>
            item.source === 'local_workout_records' && item.status === 'empty',
        ),
      ).toBe(state === 'empty');
      expect(
        result.report.coverage.some(
          item =>
            item.source === 'local_sleep_records' && item.status === 'empty',
        ),
      ).toBe(state !== 'restricted');
      const storage = createDailyReportStorage(database, native.read);
      const saved = await storage.lookup(result.context.identity);
      if (saved.status !== 'saved') throw new Error(saved.status);
      const text = conversationDailyReportText(saved);
      // Routine counts and verified absence remain available as protected
      // report details, not a fallback claim in the compact chat summary.
      const details = [
        ...dailyReportEmptyActivity(saved.report.coverage),
        ...saved.report.observations.map(item => item.text),
        ...saved.report.supportedContext
          .filter(item => !item.focus)
          .map(item => item.text),
      ];
      expect(details.includes('기록된 운동: 0회')).toBe(state === 'empty');
      expect(details.includes('기록된 운동: 1회')).toBe(state === 'recorded');
      const workoutCount = saved.report.supportedContext.find(
        item => item.text === '기록된 운동: 1회',
      );
      if (state === 'recorded')
        expect(workoutCount?.sourceReferences).toEqual([
          { source: 'health_observation', recordId: 'synthetic-workout' },
        ]);
      else expect(workoutCount).toBeUndefined();
      expect(text).not.toContain('기록된 운동:');
      expect(text).not.toContain('수면 기록이 없어요.');
      expect(text).not.toContain(
        '권한·동기화·기록 범위에 따라 빠질 수 있어요.',
      );
      expect(details.includes('수면 기록이 없어요.')).toBe(
        state !== 'restricted',
      );
      expect(text).not.toContain('않았다는 뜻');
      expect(text).not.toContain('완전한 기록이나 정상 범위');
    } finally {
      connection.close();
    }
  },
);

test('failed, stale, partial and retryable coverage must not render measured zero', () => {
  expect(
    dailyReportEmptyActivity(
      (['failed', 'stale', 'partial', 'empty'] as const).map(status => ({
        source: 'local_workout_records',
        status,
        syncStatus: 'retryable',
        lastSuccessfulAt: '2035-01-01T12:00:00Z',
        limitationCodes: ['source_query_failed'],
      })),
    ),
  ).toEqual([]);
});
