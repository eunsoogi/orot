import { prepareVisitQuestionContext } from '../evidenceService';
import {
  now,
  appointment,
  chunk,
  ports,
} from '../testing/evidenceServiceFixtures';

describe('preparing the next visit-question context', () => {
  it('provides the selected appointment without searching before a model tool request', async () => {
    const dependencies = ports();
    const buildChunks = jest.fn(async () => [chunk]);
    const result = await prepareVisitQuestionContext({
      now,
      maxEvidenceItems: 8,
      ...dependencies,
      buildChunks,
    });
    expect(result.status).toBe('ready');
    expect(buildChunks).not.toHaveBeenCalled();
    expect(dependencies.rag.index).not.toHaveBeenCalled();
    expect(dependencies.rag.search).not.toHaveBeenCalled();
    expect(dependencies.queryService.searchMemory).not.toHaveBeenCalled();
    if (result.status === 'ready')
      expect(result.evidence.batch.items).toEqual([]);
  });
  it('loads requested evidence only when its corresponding search tool runs', async () => {
    const dependencies = ports();
    const result = await prepareVisitQuestionContext({
      now,
      maxEvidenceItems: 8,
      queryService: dependencies.queryService,
      repository: dependencies.repository,
      rag: dependencies.rag,
      buildChunks: async () => [chunk],
      currentTime: () => now,
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready')
      throw new Error('The fixture appointment should be available.');
    expect(result.appointmentContext).toEqual({
      effectiveAt: appointment.effectiveAt,
      timeZoneIdentifier: 'Asia/Seoul',
      title: 'Synthetic outpatient visit',
      clinicLabel: 'Synthetic clinic',
      reason: '검사 결과 확인',
    });
    expect(result.appointmentContext).not.toHaveProperty(
      'calendarEventIdentifier',
    );
    await result.searchEvidence('검사 기록', 8, 'personal_record');
    const memory = await result.searchEvidence(
      '지난 진료 기억',
      2,
      'reviewed_memory',
      undefined,
      { store: dependencies.store },
    );
    expect(memory.memoryStatus).toBe('available');
    expect(memory.batch.items.map(item => item.sourceKind)).toEqual([
      'reviewed_memory',
    ]);
    expect(dependencies.queryService.searchMemory).not.toHaveBeenCalled();
    expect(dependencies.order).toEqual(['index', 'records', 'store-memory']);
    expect(dependencies.rag.search).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      [chunk],
      9,
      {
        filters: {
          recordTypes: [
            'encounter',
            'health_observation',
            'medication_assertion',
            'medication_definition',
            'dose_event',
            'symptom_entry',
            'evidence_span',
            'transcript_segment',
          ],
        },
      },
    );
    expect(await result.revalidateEvidence(memory.batch.items)).toBe(true);
    expect(dependencies.queryService.searchMemory).toHaveBeenCalledWith(
      '지난 진료 기억',
      expect.any(Number),
    );
    dependencies.queryService.queryNextConfirmedCalendarAppointment.mockResolvedValue(
      {
        status: 'available',
        appointment: { ...appointment, note: 'Changed during review' },
      },
    );
    expect(await result.revalidateEvidence(memory.batch.items)).toBe(false);
    expect(dependencies.rag.search).toHaveBeenCalledTimes(1);
  });

  it('stops before RAG and memory search when no confirmed Calendar appointment exists', async () => {
    const dependencies = ports({
      appointmentResult: {
        status: 'no_confirmed_upcoming_calendar_appointment',
        appointment: null,
      },
    });
    const result = await prepareVisitQuestionContext({
      now,
      maxEvidenceItems: 8,
      queryService: dependencies.queryService,
      repository: dependencies.repository,
      rag: dependencies.rag,
      buildChunks: async () => [chunk],
      currentTime: () => now,
    });

    expect(result).toEqual({ status: 'no_confirmed_upcoming_appointment' });
    expect(dependencies.order).toEqual([]);
  });

  it('reports an unavailable memory search only after the memory tool is requested', async () => {
    const dependencies = ports({ memoryError: true });
    const result = await prepareVisitQuestionContext({
      now,
      maxEvidenceItems: 8,
      queryService: dependencies.queryService,
      repository: dependencies.repository,
      rag: dependencies.rag,
      buildChunks: async () => [chunk],
      currentTime: () => now,
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready')
      throw new Error('The fixture appointment should be available.');
    const searched = await result.searchEvidence(
      '기억',
      2,
      'reviewed_memory',
      undefined,
      { store: dependencies.store },
    );
    expect(searched.memoryStatus).toBe('local_memory_unavailable');
    expect(searched.batch.coverage).toEqual([
      expect.objectContaining({
        sourceKind: 'reviewed_memory',
        gaps: expect.any(Array),
      }),
    ]);
    expect(dependencies.queryService.searchMemory).not.toHaveBeenCalled();
    expect(await result.revalidateEvidence(searched.batch.items)).toBe(false);
  });

  it('does not use the local query service as a graph-memory fallback when Store is absent', async () => {
    const dependencies = ports();
    const result = await prepareVisitQuestionContext({
      now,
      maxEvidenceItems: 8,
      queryService: dependencies.queryService,
      repository: dependencies.repository,
      rag: dependencies.rag,
      buildChunks: async () => [chunk],
    });

    if (result.status !== 'ready')
      throw new Error('The fixture appointment should be available.');
    const searched = await result.searchEvidence(
      'private memory query',
      2,
      'reviewed_memory',
    );

    expect(dependencies.store.search).not.toHaveBeenCalled();
    expect(dependencies.queryService.searchMemory).not.toHaveBeenCalled();
    expect(searched.memoryStatus).toBe('local_memory_unavailable');
    expect(searched.batch.coverage).toEqual([
      expect.objectContaining({
        sourceKind: 'reviewed_memory',
        returnedCount: 0,
        gaps: expect.any(Array),
      }),
    ]);
  });
});
