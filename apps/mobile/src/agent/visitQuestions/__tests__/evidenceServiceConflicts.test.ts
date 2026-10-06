import {
  HealthObservationSchema,
  type Appointment,
  type HealthObservation,
  type SourceRecord,
} from '@orot/domain';
import {
  chunkStructuredRecord,
  type EvidenceChunk,
  type HybridEvidenceSearchHit,
} from '@orot/rag';
import type { RecordKind, RecordRepository } from '@orot/storage';
import { prepareVisitQuestionContext } from '../evidenceService';

const now = '2026-10-07T04:00:00.000Z';
const appointment: Appointment = {
  id: 'appointment-1',
  effectiveAt: '2026-11-01T09:00:00+09:00',
  recordedAt: '2026-10-01T00:00:00Z',
  ingestedAt: '2026-10-01T00:00:00Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  status: 'scheduled',
  calendarEventIdentifier: 'private-calendar-identifier',
  calendarEventSnapshot: {
    title: 'Synthetic outpatient visit',
    timeZoneIdentifier: 'Asia/Seoul',
    isAllDay: false,
    occurrenceDate: '2026-11-01T00:00:00Z',
    isDetached: false,
    recurrenceRules: [],
  },
};

function observation(
  id: string,
  sourceId: string,
  effectiveAt: string,
  amount: number,
): HealthObservation {
  return HealthObservationSchema.parse({
    id,
    effectiveAt,
    recordedAt: effectiveAt,
    ingestedAt: '2026-09-02T00:00:00Z',
    provenance: { origin: 'device_recorded', sourceRecordIds: [sourceId] },
    reviewState: { status: 'unreviewed' },
    observationKind: 'measurement',
    concept: 'Blood Pressure',
    value: { kind: 'quantity', amount, unit: 'mmHg' },
  });
}

function sourceRecord(id: string): SourceRecord {
  return {
    id,
    effectiveAt: '2026-09-01T00:00:00Z',
    recordedAt: '2026-09-01T00:00:00Z',
    ingestedAt: '2026-09-01T00:00:00Z',
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
    sourceKind: 'other',
  };
}

function hit(chunk: EvidenceChunk): HybridEvidenceSearchHit {
  return { chunk, score: 1, lexicalRank: 1, vectorRank: 1 };
}

describe('visit-question conflicts across evidence searches', () => {
  it.each([
    { amount: 130, effectiveAt: '2026-09-01T00:00:00Z', conflict: true },
    { amount: 120, effectiveAt: '2026-09-01T00:01:00Z', conflict: false },
  ])(
    'checks an added observation against prior results without conflating later measurements',
    async ({ amount, effectiveAt, conflict }) => {
      const initial = observation(
        'observation-1',
        'source-1',
        '2026-09-01T09:00:00+09:00',
        120,
      );
      const supplemental = observation(
        'observation-2',
        'source-2',
        effectiveAt,
        amount,
      );
      const initialHit = hit(
        chunkStructuredRecord('health_observation', initial),
      );
      const supplementalHit = hit(
        chunkStructuredRecord('health_observation', supplemental),
      );
      const observations = new Map([
        [initial.id, initial],
        [supplemental.id, supplemental],
      ]);
      const sources = new Map([
        ['source-1', sourceRecord('source-1')],
        ['source-2', sourceRecord('source-2')],
      ]);
      const repository = {
        async get(kind: RecordKind, id: string) {
          if (kind === 'source_record') return sources.get(id) ?? null;
          if (kind === 'health_observation')
            return observations.get(id) ?? null;
          return null;
        },
      } as unknown as RecordRepository;
      let recordSearchCount = 0;
      const rag = {
        async index() {},
        async search(
          _query: string,
          _chunks: readonly EvidenceChunk[],
          _limit: number,
          options?: {
            readonly filters?: { readonly recordTypes?: readonly string[] };
          },
        ) {
          if (options?.filters?.recordTypes?.includes('transcript_segment'))
            return [];
          recordSearchCount += 1;
          return [recordSearchCount === 1 ? initialHit : supplementalHit];
        },
      };
      const queryService = {
        async queryNextConfirmedCalendarAppointment() {
          return { status: 'available' as const, appointment };
        },
        async searchMemory(_query: string, limit = 3) {
          return { status: 'available' as const, hits: [], limit };
        },
      };
      const prepared = await prepareVisitQuestionContext({
        now,
        maxEvidenceItems: 8,
        queryService,
        repository: repository as never,
        rag,
        buildChunks: async () => [initialHit.chunk, supplementalHit.chunk],
        currentTime: () => now,
      });

      expect(prepared.status).toBe('ready');
      if (prepared.status !== 'ready') return;
      const added = await prepared.searchEvidence(
        '최근 혈압 기록',
        3,
        'personal_record',
      );
      expect(added.batch.conflicts).toEqual(
        conflict
          ? [
              'Conflicting health observation values exist for the same concept and time.',
            ]
          : [],
      );
    },
  );
});
