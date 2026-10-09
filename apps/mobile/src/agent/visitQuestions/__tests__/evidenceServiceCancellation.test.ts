import type { LocalMemoryHit } from '@orot/agent-runtime';
import type { Appointment } from '@orot/domain';
import type {
  EmbeddingIndexOptions,
  EvidenceChunk,
  HybridEvidenceSearchHit,
  HybridSearchOptions,
} from '@orot/rag';
import type { RecordRepository } from '@orot/storage';
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
const chunk: EvidenceChunk = {
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

function ports() {
  const queryService = {
    queryNextConfirmedCalendarAppointment: jest.fn(async () => ({
      status: 'available' as const,
      appointment,
    })),
    searchMemory: jest.fn(async (_query: string, limit?: number) => ({
      status: 'available' as const,
      hits: [] as readonly LocalMemoryHit[],
      limit: limit ?? 3,
    })),
  };
  const repository = {
    async get() {
      return null;
    },
  } as unknown as RecordRepository;
  const rag = {
    index: jest.fn(
      async (
        _chunks: readonly EvidenceChunk[],
        _options?: EmbeddingIndexOptions,
      ) => {},
    ),
    search: jest.fn(
      async (
        _query: string,
        _chunks: readonly EvidenceChunk[],
        _limit = 5,
        _options?: HybridSearchOptions,
      ): Promise<readonly HybridEvidenceSearchHit[]> => [],
    ),
  };
  return { queryService, repository, rag };
}

describe('visit-question evidence cancellation', () => {
  it('forwards the same signal to local indexing and both retrieval passes', async () => {
    const dependencies = ports();
    const controller = new AbortController();
    const result = await prepareVisitQuestionContext({
      now,
      maxEvidenceItems: 8,
      ...dependencies,
      buildChunks: async () => [chunk],
      signal: controller.signal,
    });

    expect(result.status).toBe('ready');
    expect(dependencies.rag.index).toHaveBeenCalledWith([chunk], {
      signal: controller.signal,
    });
    expect(dependencies.rag.search).toHaveBeenCalledTimes(2);
    expect(dependencies.rag.search.mock.calls[0]?.[3]?.signal).toBe(
      controller.signal,
    );
    expect(dependencies.rag.search.mock.calls[1]?.[3]?.signal).toBe(
      controller.signal,
    );
  });

  it('skips local sources when context preparation starts aborted', async () => {
    const dependencies = ports();
    const controller = new AbortController();
    controller.abort();

    const result = await prepareVisitQuestionContext({
      now,
      maxEvidenceItems: 8,
      ...dependencies,
      buildChunks: async () => [chunk],
      signal: controller.signal,
    });

    expect(result).toEqual({ status: 'cancelled' });
    expect(
      dependencies.queryService.queryNextConfirmedCalendarAppointment,
    ).not.toHaveBeenCalled();
    expect(dependencies.rag.index).not.toHaveBeenCalled();
    expect(dependencies.rag.search).not.toHaveBeenCalled();
    expect(dependencies.queryService.searchMemory).not.toHaveBeenCalled();
  });

  it('does not start evidence work when appointment lookup finishes after cancellation', async () => {
    const dependencies = ports();
    const controller = new AbortController();
    dependencies.queryService.queryNextConfirmedCalendarAppointment.mockImplementationOnce(
      async () => {
        controller.abort();
        return { status: 'available', appointment };
      },
    );

    const result = await prepareVisitQuestionContext({
      now,
      maxEvidenceItems: 8,
      ...dependencies,
      buildChunks: async () => [chunk],
      signal: controller.signal,
    });

    expect(result).toEqual({ status: 'cancelled' });
    expect(dependencies.rag.index).not.toHaveBeenCalled();
    expect(dependencies.rag.search).not.toHaveBeenCalled();
    expect(dependencies.queryService.searchMemory).not.toHaveBeenCalled();
  });

  it('stops before further reads when indexing observes caller cancellation', async () => {
    const dependencies = ports();
    const controller = new AbortController();
    dependencies.rag.index.mockImplementationOnce(async (_chunks, options) => {
      expect(options?.signal).toBe(controller.signal);
      controller.abort();
    });

    const result = await prepareVisitQuestionContext({
      now,
      maxEvidenceItems: 8,
      ...dependencies,
      buildChunks: async () => [chunk],
      signal: controller.signal,
    });

    expect(result).toEqual({ status: 'cancelled' });
    expect(dependencies.rag.search).not.toHaveBeenCalled();
    expect(dependencies.queryService.searchMemory).not.toHaveBeenCalled();
  });
});
