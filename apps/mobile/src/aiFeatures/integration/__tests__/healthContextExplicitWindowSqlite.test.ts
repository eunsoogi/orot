import { createRecordRepository, runMigrations } from '@orot/storage';
import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { createHealthEvidenceTestDatabase } from '../../../healthEvidence/localEvidenceTestSupport';
import { createHealthContextReader } from '../../../healthEvidence/healthContext/reader';
import { createHealthContextTool } from '../healthContextTool';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';

const window = {
  fromInclusive: '2026-10-01T12:00:00Z',
  toExclusive: '2026-10-04T12:00:00Z',
  timeZone: 'UTC',
};
const request = {
  input: {
    window,
    topics: ['measurements', 'activity', 'sleep'],
    detail: 'daily',
  },
  operationRunId: 'synthetic',
  operationKey: 'period',
  allowedScope: { sourceKinds: ['personal_record' as const] },
  resultLimit: 8,
  maxPayloadBytes: 20480,
  signal: new AbortController().signal,
};

test('reads an exact historical window through the production tool and revalidates its source', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const records = createRecordRepository(database);
    for (const [id, at, amount] of [
      ['before', '2026-10-01T11:59:59Z', 1],
      ['start', '2026-10-01T12:00:00Z', 2],
      ['last', '2026-10-04T11:59:59Z', 4],
      ['end', '2026-10-04T12:00:00Z', 8],
    ] as const) {
      await records.put('health_observation', {
        ...healthObservation(id, 'heart_rate', at),
        ingestedAt: '2026-10-20T00:00:00Z',
        value: { kind: 'quantity', amount, unit: 'count/min' },
      });
    }
    for (const sensor of ['phone', 'watch']) {
      const record = healthObservation(
        sensor,
        'step_count',
        '2026-10-02T10:00:00Z',
      );
      await records.put('health_observation', {
        ...record,
        ingestedAt: '2026-10-20T00:00:00Z',
        provenance: {
          ...record.provenance,
          source: { system: 'healthkit', sourceIdentifier: sensor },
        },
        value: { kind: 'quantity', amount: 500, unit: 'count' },
      });
    }
    for (const [id, start, end, stage] of [
      ['core', '22:00', '23:00', '3'],
      ['duplicate', '22:00', '23:00', '3'],
      ['deep', '22:30', '23:30', '4'],
    ]) {
      await records.put('health_observation', {
        ...healthObservation(
          id!,
          'sleep',
          `2026-10-02T${start}:00Z`,
          'healthkit',
          'imported',
          `2026-10-02T${end}:00Z`,
        ),
        ingestedAt: '2026-10-20T00:00:00Z',
        value: { kind: 'text', text: stage! },
      });
    }
    const read = createHealthContextReader(database);
    const registry = new LocalEvidenceReferenceRegistry();
    const tool = createHealthContextTool(read, registry, 'rag');
    const batch = await tool.search(request);
    if ('status' in batch) throw new Error('Expected evidence');
    const contents = batch.items.map(item =>
      JSON.parse(item.content.slice('health_context: '.length)),
    );
    expect(contents.map(content => content.period)).toEqual([
      window,
      window,
      window,
    ]);
    expect(contents[0]).toMatchObject({
      calendarDays: 4,
      partialDates: ['2026-10-01', '2026-10-04'],
      quantities: [
        {
          sampleCount: 2,
          missingCalendarDays: 2,
          minimumSample: 2,
          maximumSample: 4,
        },
      ],
    });
    expect(contents[1].quantities).toHaveLength(2);
    expect(
      contents[1].quantities.map(
        (series: { meanRecordedDailySampleSum: number }) =>
          series.meanRecordedDailySampleSum,
      ),
    ).toEqual([500, 500]);
    expect(contents[2].sleep).toMatchObject({
      recordedDays: 1,
      missingCalendarDays: 3,
      meanRecordedDailyMinutes: 90,
      overlappingStageMinutes: 30,
    });
    expect(await registry.revalidateEvidence(batch.items, request.signal)).toBe(
      true,
    );
    const reference = registry.resolve(batch.items[0]!);
    expect(reference?.locator).toMatchObject({ topic: 'measurements', window });
    await records.put('health_observation', {
      ...healthObservation('new', 'heart_rate', '2026-10-03T10:00:00Z'),
      ingestedAt: '2026-10-20T00:00:00Z',
      value: { kind: 'quantity', amount: 7, unit: 'count/min' },
    });
    expect(
      await registry.revalidateEvidence([batch.items[0]!], request.signal),
    ).toBe(false);
    expect(
      (await registry.readSource(batch.items[0]!, request.signal)).status,
    ).toBe('changed');
    expect(
      await registry.revalidateEvidence(
        [batch.items[1]!, batch.items[2]!],
        request.signal,
      ),
    ).toBe(true);
  } finally {
    close();
  }
});

test('propagates a real SQLite read failure instead of returning empty evidence', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  await runMigrations(database);
  const read = createHealthContextReader(database);
  const tool = createHealthContextTool(
    read,
    new LocalEvidenceReferenceRegistry(),
    'rag',
  );
  close();
  await expect(tool.search(request)).rejects.toThrow();
});
