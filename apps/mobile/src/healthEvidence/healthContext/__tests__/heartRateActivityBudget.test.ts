import { createHealthContextTool } from '../../../aiFeatures/integration/healthContextTool';
import { LocalEvidenceReferenceRegistry } from '../../../aiFeatures/integration/evidenceRegistry';
import { jsonByteLength } from '../../../aiFeatures/integration/evidenceUtils';
import { healthContextDays } from '../window';
import type { HealthContextReader } from '../reader';
import type { projectHealthContext } from '../projection';

const window = {
  fromInclusive: '2026-01-01T00:00:00Z',
  toExclusive: '2026-04-01T00:00:00Z',
  timeZone: 'UTC',
};
const request = {
  input: { window, topics: ['measurements'] },
  operationRunId: 'synthetic-activity-context',
  operationKey: 'selected-period',
  allowedScope: { sourceKinds: ['personal_record' as const] },
  resultLimit: 1,
  maxPayloadBytes: 20_480,
  signal: new AbortController().signal,
};
function fixture() {
  const read = jest.fn<
    ReturnType<HealthContextReader>,
    Parameters<HealthContextReader>
  >(async period => {
    const days = healthContextDays(period);
    return {
      window: period,
      days,
      quantities: [
        {
          concept: 'heart_rate',
          unit: 'count/min',
          source: 'private-synthetic-sensor',
          days: days.map(day => ({
            date: day.date,
            samples: 3,
            minimum: 70,
            maximum: 150,
            mean: 110,
            sum: 330,
            latest: 110,
            firstAt: day.fromInclusive,
            lastAt: day.fromInclusive,
            activityContext: [
              {
                context: 'workout_overlap' as const,
                samples: 1,
                minimum: 150,
                maximum: 150,
              },
              {
                context: 'no_recorded_workout_overlap' as const,
                samples: 1,
                minimum: 110,
                maximum: 110,
              },
              {
                context: 'unknown' as const,
                samples: 1,
                minimum: 70,
                maximum: 70,
              },
            ],
          })),
        },
      ],
      medications: [],
      sleep: [],
      symptoms: { entryCount: 0, recordedDays: 0, latest: [] },
      limitations: [],
      mutationGeneration: 1,
      deletionGeneration: 0,
    };
  });
  const registry = new LocalEvidenceReferenceRegistry();
  return {
    read,
    registry,
    tool: createHealthContextTool(read, registry, 'rag'),
  };
}

/** Synthetic evidence validates the transfer envelope, not actual provider execution. */
test.each(['summary', 'weekly', 'daily'] as const)(
  'bounds enriched 90-day %s evidence without silently dropping strata',
  async detail => {
    const f = fixture();
    expect(f.read).not.toHaveBeenCalled();
    const result = await f.tool.search({
      ...request,
      input: { ...request.input, detail },
    });
    if ('status' in result) throw new Error('Expected period evidence.');
    expect(jsonByteLength(result)).toBeLessThanOrEqual(request.maxPayloadBytes);
    expect(result.items.length).toBeLessThanOrEqual(request.resultLimit);
    expect(JSON.stringify(result)).not.toContain('private-synthetic-sensor');
    if (detail === 'daily') {
      expect(result.items).toHaveLength(0);
      expect(result.coverage[0]?.gaps).toContain(
        'period_detail_exceeds_payload_limit_choose_fewer_topics_or_summary',
      );
    } else {
      expect(result.items).toHaveLength(1);
      const content = JSON.parse(
        result.items[0]!.content.slice('health_context: '.length),
      ) as ReturnType<typeof projectHealthContext>;
      const expected = (samples: number) => [
        {
          context: 'no_recorded_workout_overlap',
          samples,
          minimum: 110,
          maximum: 110,
        },
        { context: 'unknown', samples, minimum: 70, maximum: 70 },
        { context: 'workout_overlap', samples, minimum: 150, maximum: 150 },
      ];
      expect(content.quantities[0]?.activityContext).toEqual(expected(90));
      if (detail === 'weekly')
        expect(
          content.quantities[0]?.weeks?.map(week => week.activityContext),
        ).toEqual(
          Array.from({ length: 13 }, (_, index) =>
            expected(index === 12 ? 6 : 7),
          ),
        );
    }
  },
);

test.each([
  {
    sourceKinds: ['personal_record' as const],
    sourceIds: ['restricted-source'],
  },
  {
    sourceKinds: ['personal_record' as const],
    timeRange: {
      fromInclusive: window.fromInclusive,
      toExclusive: window.toExclusive,
    },
  },
  { sourceKinds: [] },
])(
  'never expands restricted scope to read workout context',
  async allowedScope => {
    const f = fixture();
    const result = await f.tool.search({ ...request, allowedScope });
    if ('status' in result) throw new Error('Expected coverage.');
    expect(result.items).toHaveLength(0);
    expect(f.read).not.toHaveBeenCalled();
  },
);

test('returns requested daily strata above the old feature cap when the caller permits the full envelope', async () => {
  const f = fixture();
  const result = await f.tool.search({
    ...request,
    maxPayloadBytes: 65536,
    input: { ...request.input, detail: 'daily' },
  });
  if ('status' in result) throw new Error('Expected period evidence');
  expect(result.items).toHaveLength(1);
  expect(jsonByteLength(result)).toBeGreaterThan(20480);
  expect(jsonByteLength(result)).toBeLessThanOrEqual(65536);
  expect(result.coverage[0]?.gaps).toEqual([]);
  expect(result.coverage[0]?.truncated).toBe(false);
  const content = JSON.parse(
    result.items[0]!.content.slice('health_context: '.length),
  );
  expect(content.quantities[0].days).toHaveLength(90);
  for (const day of content.quantities[0].days) {
    expect(day.activityContext).toHaveLength(3);
    expect(
      day.activityContext.reduce(
        (sum: number, group: { samples: number }) => sum + group.samples,
        0,
      ),
    ).toBe(3);
  }
  expect(JSON.stringify(result)).not.toContain('private-synthetic-sensor');
  expect(
    await f.registry.revalidateEvidence(result.items, request.signal),
  ).toBe(true);
  const current = await f.read(window, ['measurements'], request.signal);
  f.read.mockResolvedValue({
    ...current,
    deletionGeneration: current.deletionGeneration + 1,
  });
  expect(
    await f.registry.revalidateEvidence(result.items, request.signal),
  ).toBe(false);
});
