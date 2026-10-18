import type { LocalMemoryHit } from '@orot/agent-runtime';
import type { Appointment } from '@orot/domain';
import type { EvidenceChunk, HybridEvidenceSearchHit } from '@orot/rag';
import type { RecordRepository } from '@orot/storage';

export const now = '2026-10-07T04:00:00.000Z';

export const appointment: Appointment = {
  id: 'appointment-1',
  effectiveAt: '2026-11-01T09:00:00+09:00',
  recordedAt: '2026-10-01T00:00:00Z',
  ingestedAt: '2026-10-01T00:00:00Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  status: 'scheduled',
  clinicLabel: 'Synthetic clinic',
  reason: '검사 결과 확인',
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

const memoryHit: LocalMemoryHit = {
  id: 'memory-1',
  text: '사용자가 지난 진료에서 검사 결과를 먼저 확인하기로 했어요.',
  score: 0.9,
  kind: 'reviewed_interaction',
  provenance: { sourceIds: ['source-1'], reviewState: 'human_reviewed' },
  createdAt: Date.parse('2026-10-01T00:00:00Z'),
};

export const chunk: EvidenceChunk = {
  id: 'chunk-1',
  text: 'Synthetic evidence',
  metadata: {
    sourceId: 'source-1',
    sourceRecordIds: ['source-1'],
    evidenceId: 'span-1',
    evidenceLocator: { kind: 'structured_record', recordId: 'span-1' },
    effectiveTime: '2026-10-01T00:00:00Z',
    recordType: 'evidence_span',
    reviewState: { status: 'unreviewed' },
  },
};

export function ports(
  options: {
    readonly appointmentResult?: {
      readonly status:
        'available' | 'no_confirmed_upcoming_calendar_appointment';
      readonly appointment: unknown | null;
    };
    readonly memoryError?: boolean;
  } = {},
) {
  const order: string[] = [];
  const queryService = {
    queryNextConfirmedCalendarAppointment: jest.fn(
      async (afterInclusive: string) => {
        expect(afterInclusive).toBe(now);
        return (
          options.appointmentResult ?? {
            status: 'available' as const,
            appointment,
          }
        );
      },
    ),
    searchMemory: jest.fn(async (_query: string, limit?: number) => {
      order.push('memory');
      if (options.memoryError) throw new Error('synthetic memory failure');
      return {
        status: 'available' as const,
        hits: [memoryHit],
        limit: limit ?? 3,
      };
    }),
  };
  const repository = {
    async get() {
      return null;
    },
  } as unknown as RecordRepository;
  const rag = {
    index: jest.fn(async (chunks: readonly EvidenceChunk[]) => {
      expect(chunks).toEqual([chunk]);
      order.push('index');
    }),
    search: jest.fn(
      async (
        _query: string,
        _chunks: readonly EvidenceChunk[],
        _limit = 5,
        searchOptions?: {
          readonly filters?: { readonly recordTypes?: readonly string[] };
        },
      ): Promise<readonly HybridEvidenceSearchHit[]> => {
        order.push(
          searchOptions?.filters?.recordTypes?.length === 1 &&
            searchOptions.filters.recordTypes[0] === 'transcript_segment'
            ? 'transcript'
            : 'records',
        );
        return [];
      },
    ),
  };
  return { queryService, repository, rag, order };
}
