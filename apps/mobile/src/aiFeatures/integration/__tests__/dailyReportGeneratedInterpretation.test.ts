import {
  calendarFixture,
  calendarReportService,
  calendarTestObservation,
  calendarTestRequest,
} from '../testSupport/dailyReportCalendarTestFixture';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createDailyReportStorage } from '../../../storage/dailyReportStorage';

test('generated synthesis uses the exact consented payload and retained sources, not live provider data', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  const native = calendarFixture();
  native.revoke();
  try {
    await runMigrations(connection.database);
    const repository = createRecordRepository(connection.database);
    await repository.put('health_observation', calendarTestObservation);
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
      return {
        ok: true,
        value: {
          text: JSON.stringify({
            indexes: [0],
            analysis: [
              {
                kind: 'interpretation',
                text: '확인한 심박 기록은 있지만 다른 생활 기록이 부족해 여러 요인의 관계를 해석하기는 어려워요.',
                evidenceIndexes: [0],
              },
              {
                kind: 'action',
                guidanceIndex,
                evidenceIndexes: [0, guidanceIndex],
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
    expect(generated?.sourceReferences).toEqual([
      { source: 'health_observation', recordId: 'synthetic' },
    ]);
    const storage = createDailyReportStorage(connection.database, native.read);
    const saved = await storage.lookup(result.context.identity);
    expect(saved.status).toBe('saved');
    if (saved.status === 'saved')
      expect(saved.report.supportedContext).toContainEqual(generated);
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
