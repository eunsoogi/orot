import {
  DoseEventSchema,
  MedicationDefinitionSchema,
  SymptomEntrySchema,
} from '@orot/domain';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createDailyReportStorage } from '../../../storage/dailyReportStorage';
import {
  calendarFixture,
  calendarReportService,
  calendarTestObservation,
  calendarTestRequest,
} from '../testSupport/dailyReportCalendarTestFixture';

/** The real SQLite/service/consent path must send local sensor statistics, not an array of samples. */
async function fixture() {
  const db = openSqliteTestDatabase(':memory:');
  await runMigrations(db.database);
  const records = createRecordRepository(db.database);
  for (let index = 0; index < 120; index++) {
    const time = new Date(
      Date.parse('2035-01-01T01:00:00Z') + index * 1000,
    ).toISOString();
    await records.put('health_observation', {
      ...calendarTestObservation,
      // A numeric ID equal to the mean must not corrupt typed statistics during redaction.
      id: index === 0 ? '1059.5' : `sensor-${index}`,
      effectiveAt: time,
      value: { kind: 'quantity', amount: 1000 + index, unit: 'count/min' },
    });
  }
  const shared = {
    effectiveAt: '2035-01-01T02:00:00Z',
    ingestedAt: '2035-01-01T02:00:00Z',
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
  };
  await records.put(
    'symptom_entry',
    SymptomEntrySchema.parse({
      ...shared,
      id: 'symptom',
      description: '합성 증상 원문을 바꾸지 마세요',
      status: 'active',
      recordedAt: shared.effectiveAt,
    }),
  );
  await records.put(
    'medication_definition',
    MedicationDefinitionSchema.parse({
      ...shared,
      id: 'med',
      medicationConceptIdentifier: 'concept',
      displayText: '합성 약 이름',
      generalForm: 'tablet',
      isArchived: false,
      hasSchedule: true,
    }),
  );
  await records.put(
    'dose_event',
    DoseEventSchema.parse({
      ...shared,
      id: 'dose',
      eventKind: 'observed',
      medicationDefinitionId: 'med',
      observationStatus: 'taken',
      dose: { amount: 2, unit: 'tablet' },
    }),
  );
  const calendar = calendarFixture();
  calendar.revoke();
  return { db, records, calendar };
}

test('summaries replace raw points, preserve narrative/dose facts, and cite every member through save and deletion', async () => {
  const f = await fixture();
  try {
    const run = calendarReportService(f.db.database, f.calendar);
    run.generate.mockImplementation(async request => {
      const payload = JSON.parse(
        (request.messages[1] as { content: string }).content,
      );
      const index = payload.facts.findIndex((fact: { text: string }) =>
        fact.text.includes('sensor_period_summary'),
      );
      return {
        ok: true,
        value: {
          text: JSON.stringify({
            indexes: [index],
            analysis: [
              {
                kind: 'interpretation',
                text: '조회한 심박수 평균은 1059.5예요.',
                evidenceIndexes: [index],
              },
            ],
          }),
          toolCalls: [],
          finishReason: 'complete',
        },
      };
    });
    const result = await run.run(calendarTestRequest());
    if (result.status !== 'completed') throw new Error(JSON.stringify(result));
    expect(run.generate.mock.calls[0]![0]).toEqual(
      run.consent.mock.calls[0]![0].payload,
    );
    const wire = JSON.stringify(run.generate.mock.calls[0]![0]);
    expect(wire).toContain('sensor_period_summary');
    expect(wire).not.toContain('sensor-57');
    expect(wire).not.toContain('1057');
    expect(wire).not.toContain('2035-01-01T01:00:57');
    expect(wire).toContain('합성 증상 원문을 바꾸지 마세요');
    expect(wire).toContain('합성 약 이름');
    expect(wire).toContain('2 tablet');
    const payload = JSON.parse(
      (run.generate.mock.calls[0]![0].messages[1] as { content: string })
        .content,
    );
    const summarized = payload.facts.filter((fact: { text: string }) =>
      fact.text.includes('sensor_period_summary'),
    );
    expect(summarized).toHaveLength(1);
    expect(JSON.parse(summarized[0].text)).toMatchObject({
      sampleCount: 120,
      statistics: { minimum: 1000, maximum: 1119, mean: 1059.5 },
    });
    expect(result.report.observations[0]!.sourceReferences).toHaveLength(120);
    const interpreted = result.report.supportedContext.find(
      item => item.section === 'model',
    );
    expect(interpreted?.text).toContain('1059.5');
    expect(interpreted?.sourceReferences).toHaveLength(120);
    const storage = createDailyReportStorage(f.db.database, f.calendar.read);
    expect((await storage.lookup(result.context.identity)).status).toBe(
      'saved',
    );
    await f.records.delete('health_observation', 'sensor-57');
    expect((await storage.lookup(result.context.identity)).status).toBe(
      'deleted',
    );
  } finally {
    f.db.close();
  }
});

test('a deleted summarized member is excluded before renewed consent and dispatch', async () => {
  const f = await fixture();
  try {
    const run = calendarReportService(f.db.database, f.calendar, async () => {
      await f.records.delete('health_observation', 'sensor-57');
      return 'authorized';
    });
    const result = await run.run(calendarTestRequest());
    expect(result.status).toBe('completed');
    expect(run.generate).toHaveBeenCalledTimes(1);
    const message = run.generate.mock.calls[0]![0].messages[1]!;
    if (!('content' in message)) throw new Error('Expected report facts');
    const payload = JSON.parse(String(message.content));
    const summary = payload.facts.find((fact: { text: string }) =>
      fact.text.includes('sensor_period_summary'),
    );
    expect(JSON.parse(summary.text)).toMatchObject({ sampleCount: 119 });
    if (result.status === 'completed')
      expect(
        result.context.sourceSnapshot.records.map(record => record.recordId),
      ).not.toContain('sensor-57');
    expect(await f.records.get('health_observation', 'sensor-57')).toBeNull();
  } finally {
    f.db.close();
  }
});
