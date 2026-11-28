import { render, screen, fireEvent } from '@testing-library/react-native';
import { DoseEventSchema } from '@orot/domain';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createDailyReportStorage } from '../../../storage/dailyReportStorage';
import { parseDailyConversationReport } from '../../../ragConversation/dailyConversationReportTemplate';
import { buildDailyReportModelRequest } from '../dailyReportModelRequest';
import { composeDailyReportFocus } from '../dailyReportFocus';
import { DailyReportSavedSection } from '../DailyReportSavedSection';
import { conversationDailyReportText } from '../conversationDailyReportText';
import {
  calendarFixture,
  calendarReportService,
  calendarTestRequest,
} from '../testSupport/dailyReportCalendarTestFixture';

test.each(['taken', 'skipped'] as const)(
  'generated and restored report prioritizes a bounded %s day; retained evidence is on demand',
  async status => {
    const connection = openSqliteTestDatabase(':memory:');
    const native = calendarFixture();
    native.revoke();
    try {
      await runMigrations(connection.database);
      const repository = createRecordRepository(connection.database);
      const put = (index: number, date: string, event: 'taken' | 'skipped') =>
        repository.put(
          'dose_event',
          DoseEventSchema.parse({
            id: 'synthetic-dose-' + index + '-' + date,
            eventKind: 'observed',
            medicationDefinitionId: 'synthetic-med-' + index,
            observationStatus: event,
            effectiveAt: date + 'T01:00:00Z',
            ingestedAt: date + 'T02:00:00Z',
            provenance: { origin: 'user_reported', sourceRecordIds: [] },
            reviewState: { status: 'unreviewed' },
          }),
        );
      for (let index = 0; index < 4; index++) {
        await put(
          index,
          '2035-01-01',
          status === 'skipped' && index < 2 ? 'skipped' : 'taken',
        );
        await put(index, '2034-12-30', 'taken');
      }
      const { run } = calendarReportService(connection.database, native);
      const completed = await run(calendarTestRequest());
      if (completed.status !== 'completed')
        throw new Error(JSON.stringify(completed));
      const storage = createDailyReportStorage(
        connection.database,
        native.read,
      );
      const saved = await storage.lookup(completed.context.identity);
      if (saved.status !== 'saved') throw new Error('Missing saved summary');
      expect(saved.report).toEqual(completed.report);
      const focus = saved.report.supportedContext.filter(item => item.focus);
      expect(focus.filter(item => item.focus === 'takeaway')).toHaveLength(1);
      expect(
        focus.filter(item => item.focus === 'change').length,
      ).toBeLessThanOrEqual(3);
      expect(
        focus.filter(item => item.focus === 'follow_up').length,
      ).toBeLessThanOrEqual(2);
      const text = conversationDailyReportText(saved);
      expect(text).not.toContain('이전 28일');
      expect(text).not.toContain('복용·투여를 완료했어요');
      expect(parseDailyConversationReport(text)?.sections[0]?.title).toBe(
        '오늘의 핵심',
      );
      if (status === 'taken') {
        expect(focus).toHaveLength(1);
        expect(text).toContain(
          '확인한 기록에서 눈여겨볼 변화나 예외는 찾지 못했어요.',
        );
      } else {
        expect(text).toContain('누락 또는 건너뜀');
        expect(focus[0]?.sourceReferences).toEqual(
          expect.arrayContaining(
            [0, 1].map(index => ({
              source: 'dose_event',
              recordId: 'synthetic-dose-' + index + '-2035-01-01',
            })),
          ),
        );
      }
      const view = await render(
        <DailyReportSavedSection
          saved={saved}
          feature={{ lookup: storage.lookup } as never}
          onChat={jest.fn()}
          onStale={jest.fn()}
        />,
      );
      try {
        expect(screen.getByText('오늘의 핵심')).toBeVisible();
        expect(screen.queryAllByText(/이전 28일/)).toHaveLength(0);
        await fireEvent.press(screen.getByText('근거 기록 보기'));
        expect(screen.getAllByText(/이전 28일/).length).toBeGreaterThan(1);
      } finally {
        await view.unmount();
      }
    } finally {
      connection.close();
    }
  },
);

test('the same selected-provider request bounds prose and leaves urgent override intact', () => {
  const routine = buildDailyReportModelRequest({
    facts: [{ text: 'Synthetic evidence' }],
  });
  const urgent = buildDailyReportModelRequest({
    allowAnalysis: false,
    facts: [{ text: 'Synthetic guidance' }],
  });
  expect(routine.messages[0]).toMatchObject({
    role: 'system',
    content: expect.stringContaining('one takeaway'),
  });
  expect(routine.messages[0]).toMatchObject({
    role: 'system',
    content: expect.stringContaining('same metric, unit, source'),
  });
  expect(urgent.messages[0]).toMatchObject({
    role: 'system',
    content: expect.stringContaining('return an empty analysis array'),
  });
});

test('explicit attention outranks routine, changes and follow-ups stay bounded', () => {
  const claim = (id: string) => ({
    text: id,
    sourceReferences: [{ source: 'health_observation', recordId: id }],
  });
  const summary = composeDailyReportFocus({
    priority: [claim('urgent')],
    comparisons: Array.from({ length: 6 }, (_, index) =>
      claim('change-' + index),
    ),
    candidates: [
      { ...claim('routine'), role: 'routine' },
      { ...claim('exception A'), role: 'exception' },
      { ...claim('exception B'), role: 'exception' },
      ...Array.from({ length: 4 }, (_, index) => ({
        ...claim('follow-up-' + index),
        role: 'follow_up' as const,
      })),
    ],
    firstSource: undefined,
    generated: [],
  });
  expect(summary.map(item => item.focus)).toEqual([
    'takeaway',
    'change',
    'change',
    'change',
    'follow_up',
    'follow_up',
  ]);
  expect(summary[0]).toMatchObject({ ...claim('urgent'), focus: 'takeaway' });
  expect(summary[1]?.text).toBe('exception A exception B');
  expect(summary[1]?.sourceReferences).toEqual([
    ...claim('exception A').sourceReferences,
    ...claim('exception B').sourceReferences,
  ]);
});
