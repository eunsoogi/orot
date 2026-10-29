import type { SymptomEntry } from '@orot/storage';
import type { SymptomJournalRepository } from '../src/symptoms/localRepository';
import type { RecordingSourceRecord } from '../src/recording/recordingTypes';

const timestamp = '2026-10-20T09:00:00Z';
const metadata = {
  effectiveAt: timestamp,
  recordedAt: timestamp,
  ingestedAt: timestamp,
  provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' as const },
};
const symptom: SymptomEntry = {
  ...metadata,
  id: 'synthetic-home-active',
  description: '합성 지속 증상',
  status: 'active',
};

/** Read-only fixture for the existing Home timing probe; it never reaches production data loaders. */
export const homeOverviewJournal: SymptomJournalRepository = {
  list: async filter =>
    [symptom].filter(
      entry => !filter?.status || entry.status === filter.status,
    ),
  create: async () => {
    throw new Error('Read-only Home fixture');
  },
  update: async () => {
    throw new Error('Read-only Home fixture');
  },
  resolve: async () => {
    throw new Error('Read-only Home fixture');
  },
};
export const homeOverviewRecordings: readonly RecordingSourceRecord[] = [
  {
    ...metadata,
    id: 'synthetic-home-recording',
    sourceKind: 'audio_recording',
    title: '합성 최근 녹음',
  },
];
