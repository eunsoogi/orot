import {
  calendarFixture,
  calendarReportService,
  calendarTestObservation,
  calendarTestRequest,
} from '../testSupport/dailyReportCalendarTestFixture';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { conversationDailyReportText } from '../conversationDailyReportText';
import { createDailyReportStorage } from '../../../storage/dailyReportStorage';

test('generated synthesis uses the exact consented payload and retained sources, not live provider data', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  const native = calendarFixture();
  native.revoke();
  try {
    await runMigrations(connection.database);
    const repository = createRecordRepository(connection.database);
    await repository.put('health_observation', {
      ...calendarTestObservation,
      concept: 'blood_pressure_systolic',
      value: { kind: 'quantity', amount: 140, unit: 'mmHg' },
    });
    await repository.put('health_observation', {
      ...calendarTestObservation,
      id: 'synthetic-supporting',
    });
    const { run, generate, consent } = calendarReportService(
      connection.database,
      native,
    );
    generate.mockImplementation(async request => {
      const payload = JSON.parse(
        (request.messages[1] as { content: string }).content,
      );
      expect(payload.context.localDate).toBe('2035-01-01');
      expect(payload.context.coverage).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: 'system_calendar',
            status: 'unknown',
          }),
        ]),
      );
      const guidanceIndex = payload.facts.findIndex(
        (fact: { role: string }) => fact.role === 'guidance',
      );
      const index = (concept: string) =>
        payload.facts.findIndex(
          (fact: { role: string; text: string }) =>
            fact.role === 'evidence' && fact.text.includes(concept),
        );
      const pressureIndex = index('blood_pressure_systolic');
      const extraIndex = index('heart_rate');
      expect(pressureIndex).toBeGreaterThanOrEqual(0);
      expect(extraIndex).toBeGreaterThanOrEqual(0);
      return {
        ok: true,
        value: {
          text: JSON.stringify({
            indexes: [guidanceIndex],
            analysis: [
              {
                kind: 'interpretation',
                text: '기록한 혈압 수치는 다음 혈압 기록과 비교할 때 참고할 수 있어요.',
                evidenceIndexes: [pressureIndex],
              },
              {
                kind: 'action',
                guidanceIndex,
                evidenceIndexes: [pressureIndex, extraIndex, guidanceIndex],
              },
            ],
          }),
          toolCalls: [],
          finishReason: 'complete',
        },
      };
    });
    const result = await run(calendarTestRequest());
    if (result.status !== 'completed') throw new Error(JSON.stringify(result));
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0]![0]).toEqual(
      consent.mock.calls[0]![0].payload,
    );
    expect(consent.mock.calls[0]![0].consentScope?.policyVersion).toBe(
      'daily-report-analysis-v2',
    );
    const generated = result.report.supportedContext.find(item =>
      item.text.startsWith('AI 해석:'),
    );
    expect(generated?.section).toBe('model');
    expect(result.report.observations).toHaveLength(1);
    const advice = result.report.supportedContext.filter(item =>
      item.text.includes('혈압은 재확인과 상담이 필요해요.'),
    );
    expect(advice).toHaveLength(1);
    expect(advice[0]).toMatchObject({
      section: 'priority',
      sourceReferences: [
        { source: 'health_observation', recordId: 'synthetic' },
      ],
    });
    const expectedExtra = {
      text: 'AI가 바로 앞의 안내를 선택할 때 함께 참고한 기록이에요.',
      section: 'model',
      sourceReferences: [
        { source: 'health_observation', recordId: 'synthetic-supporting' },
      ],
    };
    expect(result.report.supportedContext.indexOf(advice[0]!) + 1).toBe(
      result.report.supportedContext.findIndex(
        item => item.text === expectedExtra.text,
      ),
    );
    expect(result.report.supportedContext).toContainEqual(expectedExtra);
    expect(result.report.observations[0]?.text).not.toBe(advice[0]?.text);
    expect(generated?.sourceReferences).toEqual([
      { source: 'health_observation', recordId: 'synthetic' },
    ]);
    const storage = createDailyReportStorage(connection.database, native.read);
    const saved = await storage.lookup(result.context.identity);
    expect(saved.status).toBe('saved');
    if (saved.status !== 'saved')
      throw new Error('Expected exact persisted report');
    expect(saved.report.supportedContext).toContainEqual(generated);
    expect(saved.report.supportedContext).toContainEqual(expectedExtra);
    expect(
      conversationDailyReportText(saved).split(advice[0]!.text),
    ).toHaveLength(2);
    await repository.delete('health_observation', 'synthetic');
    expect((await storage.lookup(result.context.identity)).status).toBe(
      'deleted',
    );
  } finally {
    connection.close();
  }
});

test('a severe interval pressure keeps reviewed urgent guidance and never displays unsolicited generated reassurance', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  const native = calendarFixture();
  native.revoke();
  try {
    await runMigrations(connection.database);
    await createRecordRepository(connection.database).put(
      'health_observation',
      {
        ...calendarTestObservation,
        concept: 'blood_pressure_systolic',
        endedAt: '2035-01-01T01:00:01Z',
        value: { kind: 'quantity', amount: 190, unit: 'mmHg' },
      },
    );
    const { run, generate } = calendarReportService(
      connection.database,
      native,
    );
    generate.mockResolvedValue({
      ok: true,
      value: {
        text: JSON.stringify({
          indexes: [0],
          analysis: [
            {
              kind: 'interpretation',
              text: '합성 잘못된 안심 문장'.repeat(100),
              evidenceIndexes: [0],
            },
          ],
        }),
        toolCalls: [],
        finishReason: 'complete',
      },
    });
    const result = await run(calendarTestRequest());
    if (result.status !== 'completed') throw new Error(JSON.stringify(result));
    expect(result.report.supportedContext[0]!.text).toContain('119');
    expect(
      result.report.supportedContext.some(item => item.section === 'model'),
    ).toBe(false);
    expect(JSON.stringify(result.report)).not.toContain('합성 잘못된 안심');
  } finally {
    connection.close();
  }
});
