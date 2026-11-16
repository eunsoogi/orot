import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createDailyReportStorage } from '../../../storage/dailyReportStorage';
import {
  calendarFixture,
  calendarReportService,
  calendarTestObservation,
  calendarTestRequest,
} from '../testSupport/dailyReportCalendarTestFixture';

/** Real SQLite, synthetic records/provider: verifies exact consent and durable source lineage. */
test('conflict guidance remains cited, consented and deletion-aware independently of model selection', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  const native = calendarFixture();
  native.revoke();
  try {
    await runMigrations(connection.database);
    const repository = createRecordRepository(connection.database);
    for (const [id, amount] of [
      ['pressure-one', 145],
      ['pressure-two', 110],
    ] as const) {
      await repository.put('health_observation', {
        ...calendarTestObservation,
        id,
        concept: 'blood_pressure_systolic',
        value: { kind: 'quantity', amount, unit: 'mmHg' },
      });
    }
    const { run, generate, consent } = calendarReportService(
      connection.database,
      native,
    );
    generate.mockResolvedValue({
      ok: true,
      value: {
        text: JSON.stringify({ indexes: [0], analysis: [] }),
        toolCalls: [],
        finishReason: 'complete',
      },
    });
    const result = await run(calendarTestRequest());
    if (result.status !== 'completed') throw new Error(JSON.stringify(result));
    expect(generate.mock.calls[0]![0]).toEqual(
      consent.mock.calls[0]![0].payload,
    );
    const claim = result.report.supportedContext.find(item =>
      item.text.includes('어느 기록이 정확한지'),
    )!;
    expect(claim.section).toBe('priority');
    expect(claim.sourceReferences).toEqual(
      expect.arrayContaining([
        { source: 'health_observation', recordId: 'pressure-one' },
        { source: 'health_observation', recordId: 'pressure-two' },
      ]),
    );
    const payload = JSON.parse(
      (generate.mock.calls[0]![0].messages[1] as { content: string }).content,
    );
    expect(payload.facts).toContainEqual(
      expect.objectContaining({ role: 'guidance', text: claim.text }),
    );
    const storage = createDailyReportStorage(connection.database, native.read);
    const saved = await storage.lookup(result.context.identity);
    expect(saved.status).toBe('saved');
    if (saved.status === 'saved')
      expect(saved.report.supportedContext).toContainEqual(claim);
    await repository.delete('health_observation', 'pressure-two');
    expect((await storage.lookup(result.context.identity)).status).toBe(
      'deleted',
    );
  } finally {
    connection.close();
  }
});
