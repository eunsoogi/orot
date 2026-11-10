import type {
  DailyReportProviderMetadata,
  DailyReportSourceRecord,
} from '@orot/domain';
import type { DailyReportSourceSnapshot } from '../dailyReportContext';

/** Synthetic contract fixture; its records and coverage are not user health data. */
export const dailyReportRequestFixture = {
  localDate: '2026-03-08',
  timeZone: 'America/New_York',
  requestedAt: '2026-03-08T16:15:00.000Z',
} as const;

export const dailyReportProviderFixture: DailyReportProviderMetadata = {
  providerId: 'on-device',
  modelId: 'selected-model',
  modelVersion: '1',
};

export const dailyReportSourceRecordsFixture: readonly DailyReportSourceRecord[] =
  [
    {
      source: 'healthkit.sleep',
      recordId: 'sleep-cross-midnight',
      revision: 'r2',
      occurrence: {
        startInclusive: '2026-03-08T04:30:00.000Z',
        endExclusive: '2026-03-08T05:30:00.000Z',
      },
      ingestedAt: '2026-03-08T07:00:00.000Z',
    },
    {
      source: 'healthkit.phone',
      recordId: 'steps-phone',
      revision: 'r1',
      occurrence: { startInclusive: '2026-03-08T15:00:00.000Z' },
      ingestedAt: '2026-03-08T15:02:00.000Z',
    },
    {
      source: 'healthkit.watch',
      recordId: 'steps-watch',
      revision: 'r1',
      occurrence: { startInclusive: '2026-03-08T15:00:00.000Z' },
      ingestedAt: '2026-03-08T15:02:00.000Z',
    },
    {
      source: 'healthkit',
      recordId: 'late-arrival',
      revision: 'r1',
      occurrence: { startInclusive: '2026-03-08T10:00:00.000Z' },
      ingestedAt: '2026-03-08T16:16:00.000Z',
    },
    {
      source: 'healthkit',
      recordId: 'after-cutoff',
      revision: 'r1',
      occurrence: { startInclusive: '2026-03-08T16:16:00.000Z' },
      ingestedAt: '2026-03-08T16:14:00.000Z',
    },
  ];

export const dailyReportSourceSnapshotFixture: DailyReportSourceSnapshot = {
  revision: 'snapshot-r7',
  mutationGeneration: 7,
  deletionGeneration: 2,
  records: dailyReportSourceRecordsFixture,
  coverage: [
    {
      source: 'healthkit',
      status: 'partial',
      syncStatus: 'retryable',
      lastAttemptAt: '2026-03-08T16:10:00.000Z',
      lastSuccessfulAt: '2026-03-07T15:00:00.000Z',
      availableThrough: '2026-03-07T15:00:00.000Z',
      limitationCodes: ['sync_incomplete'],
    },
    {
      source: 'manual',
      status: 'available',
      limitationCodes: [],
    },
    {
      source: 'empty-source',
      status: 'empty',
      lastSuccessfulAt: '2026-03-08T16:00:00.000Z',
      limitationCodes: [],
    },
    {
      source: 'not-requested-source',
      status: 'unknown',
      syncStatus: 'not_requested',
      limitationCodes: [],
    },
    {
      source: 'failed-source',
      status: 'failed',
      syncStatus: 'retryable',
      lastAttemptAt: '2026-03-08T16:10:00.000Z',
      limitationCodes: ['source_query_failed'],
    },
    {
      source: 'stale-source',
      status: 'stale',
      lastSuccessfulAt: '2026-03-01T15:00:00.000Z',
      limitationCodes: ['source_data_stale'],
    },
  ],
};
