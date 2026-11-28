import { fireEvent, render, screen } from '@testing-library/react-native';
import { DoseEventSchema, HealthObservationSchema } from '@orot/domain';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createDailyReportStorage } from '../../../storage/dailyReportStorage';
import { DailyReportSavedSection } from '../DailyReportSavedSection';
import { conversationDailyReportText } from '../conversationDailyReportText';
import {
  calendarFixture,
  calendarReportService,
  calendarTestObservation,
  calendarTestRequest,
} from '../testSupport/dailyReportCalendarTestFixture';

const quiet = '확인한 기록에서 눈여겨볼 변화나 예외는 찾지 못했어요.';
const pulseEndpoints = /첫 기록은.+마지막 기록은/;

function measurement(
  id: string,
  at: string,
  concept: string,
  amount: number,
  unit: string,
) {
  return HealthObservationSchema.parse({
    ...calendarTestObservation,
    id,
    effectiveAt: at,
    recordedAt: at,
    ingestedAt: at,
    concept,
    value: { kind: 'quantity', amount, unit },
  });
}

test.each([
  { todayWeight: undefined, outsideHistory: false, missed: false },
  { todayWeight: 61, outsideHistory: false, missed: false },
  { todayWeight: 65, outsideHistory: true, missed: true },
])(
  'prioritizes supported changes across data types without promoting endpoints ($todayWeight / $missed)',
  async ({ todayWeight, outsideHistory, missed }) => {
    const connection = openSqliteTestDatabase(':memory:');
    const native = calendarFixture();
    native.revoke();
    try {
      await runMigrations(connection.database);
      const repository = createRecordRepository(connection.database);
      const weights =
        todayWeight === undefined
          ? []
          : [
              measurement(
                'current-weight',
                '2035-01-01T02:00:00Z',
                'body_mass',
                todayWeight,
                'kg',
              ),
              measurement(
                'weight-1',
                '2034-12-29T02:00:00Z',
                'body_mass',
                60,
                'kg',
              ),
              measurement(
                'weight-2',
                '2034-12-30T02:00:00Z',
                'body_mass',
                62,
                'kg',
              ),
              measurement(
                'weight-3',
                '2034-12-31T02:00:00Z',
                'body_mass',
                64,
                'kg',
              ),
            ];
      for (const point of [
        measurement(
          'pulse-a',
          '2035-01-01T01:00:00Z',
          'heart_rate',
          101,
          'count/min',
        ),
        measurement(
          'pulse-b',
          '2035-01-01T05:00:00Z',
          'heart_rate',
          102,
          'count/min',
        ),
        ...weights,
      ]) {
        await repository.put('health_observation', point);
      }
      if (missed) {
        await repository.put(
          'dose_event',
          DoseEventSchema.parse({
            id: 'missed-dose',
            eventKind: 'observed',
            medicationDefinitionId: 'test-medication',
            observationStatus: 'skipped',
            effectiveAt: '2035-01-01T06:00:00Z',
            ingestedAt: '2035-01-01T06:00:00Z',
            provenance: { origin: 'user_reported', sourceRecordIds: [] },
            reviewState: { status: 'unreviewed' },
          }),
        );
      }
      const { run } = calendarReportService(connection.database, native);
      const completed = await run(calendarTestRequest());
      if (completed.status !== 'completed')
        throw new Error(JSON.stringify(completed));
      const storage = createDailyReportStorage(
        connection.database,
        native.read,
      );
      const reopened = await storage.lookup(completed.context.identity);
      if (reopened.status !== 'saved')
        throw new Error('Synthetic report unavailable after reopen');
      expect(reopened.report).toEqual(completed.report);

      const focus = reopened.report.supportedContext.filter(item => item.focus);
      const text = conversationDailyReportText(reopened);
      expect(text).not.toMatch(pulseEndpoints);
      expect(reopened.report.supportedContext).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            section: 'patterns',
            text: expect.stringMatching(pulseEndpoints),
            sourceReferences: [
              { source: 'health_observation', recordId: 'pulse-a' },
              { source: 'health_observation', recordId: 'pulse-b' },
            ],
          }),
        ]),
      );
      if (outsideHistory) {
        expect(focus).toHaveLength(2);
        expect(focus.find(item => item.focus === 'takeaway')?.text).toContain(
          '누락 또는 건너뜀',
        );
        const change = focus.find(item => item.focus === 'change');
        expect(change?.sourceReferences).toEqual(
          expect.arrayContaining(
            weights.map(point => ({
              source: 'health_observation',
              recordId: point.id,
            })),
          ),
        );
        expect(text).toContain('과거 3일의 일별 중앙값 범위');
        expect(text).not.toContain('질병 진단 기준은 아니에요');
      } else {
        expect(focus).toHaveLength(1);
        expect(text).toContain(quiet);
        if (todayWeight !== undefined) {
          expect(text).not.toContain('관측된 3일');
          expect(
            reopened.report.supportedContext.some(
              item =>
                item.section === 'history' && item.text.includes('관측된 3일'),
            ),
          ).toBe(true);
        }
      }

      const view = await render(
        <DailyReportSavedSection
          saved={reopened}
          feature={{ lookup: storage.lookup } as never}
          onChat={jest.fn()}
          onStale={jest.fn()}
        />,
      );
      try {
        expect(screen.queryByText(pulseEndpoints)).toBeNull();
        expect(
          screen.getByText(focus.find(item => item.focus === 'takeaway')!.text),
        ).toBeVisible();
        await fireEvent.press(screen.getByText('근거 기록 보기'));
        expect(screen.getByText(pulseEndpoints)).toBeVisible();
      } finally {
        await view.unmount();
      }
    } finally {
      connection.close();
    }
  },
);
