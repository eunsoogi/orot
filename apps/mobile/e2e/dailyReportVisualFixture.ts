import {
  createDailyReportIdentity,
  DailyReportOutputSchema,
} from '@orot/domain';
import type { createDailyReportFeature } from '../src/aiFeatures/integration/dailyReportFeature';
import { createDailyReportCalendarWindow } from '../src/healthEvidence/healthContext/dailyReportWindow';
import { createDailyReportContext } from '../src/healthEvidence/healthContext/dailyReportContext';

export const identity = createDailyReportIdentity('2035-01-01', 'Asia/Seoul');
export const target = { identity, runId: 'synthetic-report', revision: 2 };
const calendar = createDailyReportCalendarWindow({
  localDate: identity.localDate,
  timeZone: identity.timeZone,
  requestedAt: '2035-01-01T03:00:00Z',
});
if (calendar.status !== 'ready') throw new Error('Invalid visual fixture date');
const context = createDailyReportContext(
  calendar.context,
  {
    revision: 'synthetic-snapshot',
    mutationGeneration: 0,
    deletionGeneration: 0,
    records: [
      {
        source: 'manual',
        recordId: 'synthetic-source',
        revision: 'synthetic-revision',
        occurrence: { startInclusive: '2035-01-01T01:00:00Z' },
        ingestedAt: '2035-01-01T01:00:00Z',
      },
    ],
    coverage: [],
  },
  { providerId: 'synthetic-local', modelId: 'synthetic-model' },
);
const saved = {
  status: 'saved' as const,
  ...target,
  context,
  lineage: [
    {
      source: 'manual',
      recordId: 'synthetic-source',
      kind: 'health_observation' as const,
      localId: 'synthetic-source',
      revision: 'synthetic-revision',
    },
  ],
  report: DailyReportOutputSchema.parse({
    schemaVersion: 1,
    identity,
    generatedAt: '2035-01-01T03:01:00Z',
    observations: [
      {
        text: '합성 심박수 기록은 72회예요.',
        sourceReferences: [{ source: 'manual', recordId: 'synthetic-source' }],
      },
    ],
    supportedContext: [],
    followUpQuestions: [],
    coverage: [
      {
        source: 'health_observation',
        status: 'partial',
        limitationCodes: ['partial_day'],
      },
    ],
  }),
} satisfies Extract<
  Awaited<ReturnType<ReturnType<typeof createDailyReportFeature>['lookup']>>,
  { status: 'saved' }
>;

/** This visual fixture never reads or writes a saved report or invokes AI. */
export const feature: ReturnType<typeof createDailyReportFeature> = {
  lookup: async requested =>
    requested.key === identity.key ? saved : { status: 'missing' },
  preview: async () => ({ status: 'not_today' }),
  retain: () => () => {},
  active: () => null,
  start: () => {
    throw new Error('The visual fixture must not generate.');
  },
};
