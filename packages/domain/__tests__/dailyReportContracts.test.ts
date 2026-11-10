import {
  createDailyReportIdentity,
  DailyReportContextSchema,
  DailyReportGenerationResultSchema,
  DailyReportOutputSchema,
} from '../src';

const cutoff = '2026-11-10T04:00:00.000Z';
const identity = createDailyReportIdentity('2026-11-10', 'Asia/Seoul');

function contextFixture() {
  return {
    kind: 'daily_report_context' as const,
    schemaVersion: 1 as const,
    identity,
    interval: {
      fromInclusive: '2026-11-09T15:00:00.000Z',
      toExclusive: '2026-11-10T15:00:00.000Z',
    },
    generationCutoff: cutoff,
    effectiveCutoff: cutoff,
    sourceSnapshot: {
      revision: 'snapshot-r4',
      mutationGeneration: 7,
      deletionGeneration: 4,
      records: [
        {
          source: 'healthkit',
          recordId: 'sleep-1',
          revision: 'r2',
          occurrence: {
            startInclusive: '2026-11-09T14:30:00.000Z',
            endExclusive: '2026-11-09T15:30:00.000Z',
          },
          ingestedAt: '2026-11-10T00:00:00.000Z',
        },
        {
          source: 'manual',
          recordId: 'note-1',
          revision: 'r1',
          occurrence: { startInclusive: '2026-11-10T03:00:00.000Z' },
          ingestedAt: '2026-11-10T03:05:00.000Z',
        },
      ],
      coverage: [
        {
          source: 'healthkit',
          status: 'partial' as const,
          syncStatus: 'retryable' as const,
          lastAttemptAt: cutoff,
          lastSuccessfulAt: '2026-11-09T15:00:00.000Z',
          availableThrough: '2026-11-09T15:00:00.000Z',
          limitationCodes: ['sync_incomplete'],
        },
        {
          source: 'manual',
          status: 'available' as const,
          limitationCodes: [],
        },
        {
          source: 'records-with-no-observation',
          status: 'empty' as const,
          lastSuccessfulAt: cutoff,
          limitationCodes: [],
        },
        {
          source: 'unobserved',
          status: 'unknown' as const,
          syncStatus: 'not_requested' as const,
          limitationCodes: [],
        },
        {
          source: 'failed-source',
          status: 'failed' as const,
          syncStatus: 'retryable' as const,
          lastAttemptAt: cutoff,
          limitationCodes: ['source_query_failed'],
        },
        {
          source: 'stale-source',
          status: 'stale' as const,
          lastSuccessfulAt: '2026-11-01T00:00:00.000Z',
          limitationCodes: ['source_data_stale'],
        },
      ],
    },
    provider: {
      providerId: 'on-device',
      modelId: 'selected-model',
      modelVersion: '1',
    },
  };
}

test('accepts half-open occurrence intervals, late-arriving records and explicit coverage states', () => {
  const context = DailyReportContextSchema.parse(contextFixture());

  expect(context.interval).toEqual({
    fromInclusive: '2026-11-09T15:00:00.000Z',
    toExclusive: '2026-11-10T15:00:00.000Z',
  });
  expect(context.sourceSnapshot.records.map((record) => record.recordId)).toEqual([
    'sleep-1',
    'note-1',
  ]);
  expect(context.sourceSnapshot.coverage.map((item) => item.status)).toEqual([
    'partial',
    'available',
    'empty',
    'unknown',
    'failed',
    'stale',
  ]);
});

test('requires the actual generation cutoff and source revisions to match the snapshot', () => {
  const value = contextFixture();
  expect(DailyReportContextSchema.safeParse(value).success).toBe(true);
  expect(
    DailyReportContextSchema.safeParse({
      ...value,
      interval: {
        fromInclusive: '2026-11-09T16:00:00.000Z',
        toExclusive: '2026-11-10T16:00:00.000Z',
      },
    }).success,
  ).toBe(false);
  expect(
    DailyReportContextSchema.safeParse({
      ...value,
      effectiveCutoff: '2026-11-10T15:00:00.000Z',
    }).success,
  ).toBe(false);
  expect(
    DailyReportContextSchema.safeParse({
      ...value,
      sourceSnapshot: {
        ...value.sourceSnapshot,
        records: [
          ...value.sourceSnapshot.records,
          {
            ...value.sourceSnapshot.records[1],
            ingestedAt: '2026-11-10T04:00:00.001Z',
          },
        ],
      },
    }).success,
  ).toBe(false);
  expect(
    DailyReportContextSchema.safeParse({
      ...value,
      sourceSnapshot: {
        ...value.sourceSnapshot,
        deletionGeneration: 8,
      },
    }).success,
  ).toBe(false);
});

test('rejects records outside the available day window and empty coverage without a successful read', () => {
  const value = contextFixture();
  expect(
    DailyReportContextSchema.safeParse({
      ...value,
      sourceSnapshot: {
        ...value.sourceSnapshot,
        records: [
          {
            ...value.sourceSnapshot.records[1],
            occurrence: { startInclusive: '2026-11-10T04:00:00.000Z' },
          },
        ],
      },
    }).success,
  ).toBe(false);
  const emptyMidnightWindow = {
    ...value,
    generationCutoff: '2026-11-09T15:00:00.000Z',
    effectiveCutoff: '2026-11-09T15:00:00.000Z',
    sourceSnapshot: {
      ...value.sourceSnapshot,
      records: [
        {
          ...value.sourceSnapshot.records[0],
          ingestedAt: '2026-11-09T15:00:00.000Z',
        },
      ],
      coverage: [],
    },
  };
  expect(DailyReportContextSchema.safeParse(emptyMidnightWindow).success).toBe(false);
  expect(
    DailyReportContextSchema.safeParse({
      ...value,
      sourceSnapshot: {
        ...value.sourceSnapshot,
        coverage: [
          {
            source: 'empty',
            status: 'empty',
            limitationCodes: [],
          },
        ],
      },
    }).success,
  ).toBe(false);
});

test('keeps completed reports source-linked and distinguishes generation failures', () => {
  const validReport = {
    schemaVersion: 1 as const,
    identity,
    generatedAt: cutoff,
    observations: [
      {
        text: 'A recorded observation.',
        sourceReferences: [{ source: 'healthkit', recordId: 'sleep-1' }],
      },
    ],
    supportedContext: [],
    coverage: contextFixture().sourceSnapshot.coverage,
    followUpQuestions: ['Would you like to add context to this observation?'],
  };

  expect(DailyReportOutputSchema.safeParse(validReport).success).toBe(true);
  expect(
    DailyReportOutputSchema.safeParse({
      ...validReport,
      observations: [{ text: 'Unlinked claim.', sourceReferences: [] }],
    }).success,
  ).toBe(false);
  expect(
    DailyReportGenerationResultSchema.parse({
      status: 'failed',
      code: 'consent_required',
      retryable: false,
    }),
  ).toEqual({ status: 'failed', code: 'consent_required', retryable: false });
  expect(
    DailyReportGenerationResultSchema.safeParse({
      status: 'completed',
      report: null,
    }).success,
  ).toBe(false);
});
