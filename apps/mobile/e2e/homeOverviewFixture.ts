import type { RecordRepository } from '@orot/storage';
import type { RecordingSourceRecord } from '../src/recording/recordingTypes';

const timestamp = '2026-10-20T09:00:00Z';
const metadata = {
  effectiveAt: timestamp,
  recordedAt: timestamp,
  ingestedAt: timestamp,
  provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' as const },
};
export const homeOverviewRecordings: readonly RecordingSourceRecord[] = [
  {
    ...metadata,
    id: 'synthetic-home-recording',
    sourceKind: 'audio_recording',
    title: '합성 최근 녹음',
  },
];

/** Seeds actual local observations only for the isolated Home navigation probe. */
export async function seedHomeOverviewHealth(
  records: RecordRepository,
  now: Date,
): Promise<void> {
  const ingestedAt = now.toISOString();
  const source = {
    system: 'healthkit',
    sourceIdentifier: 'synthetic.home.watch',
    sourceName: 'Synthetic Watch',
    productType: 'Synthetic Watch',
  };
  await records.transaction(async writer => {
    // Distinct recorded days leave genuine gaps and cover both completed comparison windows.
    for (const daysAgo of [1, 3, 8, 10]) {
      const date = new Date(now);
      date.setDate(date.getDate() - daysAgo);
      date.setHours(9, 0, 0, 0);
      const effectiveAt = date.toISOString();
      const common = {
        effectiveAt,
        recordedAt: effectiveAt,
        ingestedAt,
        provenance: {
          origin: 'imported' as const,
          sourceRecordIds: [],
          source,
        },
        reviewState: { status: 'unreviewed' as const },
      };
      await writer.put('health_observation', {
        ...common,
        id: `synthetic-home-heart-${daysAgo}`,
        observationKind: 'measurement',
        concept: 'heart_rate',
        value: { kind: 'quantity', amount: 65 + daysAgo, unit: 'count/min' },
      });
      const end = new Date(date.getTime() + 60 * 60_000).toISOString();
      await writer.put('health_observation', {
        ...common,
        id: `synthetic-home-sleep-${daysAgo}`,
        endedAt: end,
        observationKind: 'other',
        concept: 'HKCategoryTypeIdentifierSleepAnalysis',
        value: { kind: 'text', text: 'asleepCore' },
      });
    }
  });
}
