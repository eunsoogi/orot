import { createLocalRecordQueryService, createLocalRecordQueryTools } from '../src';
import type { LocalMemoryHit, LocalMemoryReader, LocalRecordQueryStorage } from '../src';

const fromInclusive = '2026-10-01T00:00:00.000Z';
const toExclusive = '2026-10-02T00:00:00.000Z';

describe('local record query tools', () => {
  it('forwards fixed filters and preserves source-linked query results', async () => {
    const observation = {
      id: 'heart-rate-1',
      concept: 'heart_rate',
      effectiveAt: '2026-10-01T10:00:00.000Z',
      value: { kind: 'quantity', amount: 72, unit: 'count/min' },
      provenance: { sourceRecordIds: ['healthkit-sample-1'] },
    };
    const storage = {
      queryHealthObservations: jest.fn(async (filter) => ({
        status: 'available' as const,
        records: [observation],
        hasMore: false,
        limit: filter.limit ?? 25,
      })),
      queryImportedMedicationDefinitions: jest.fn(async () => ({
        status: 'no_local_records_in_range' as const,
        records: [],
        hasMore: false,
        limit: 25,
        timeBasis: 'local_ingest' as const,
      })),
      queryImportedDoseEvents: jest.fn(async () => ({
        status: 'no_local_records_in_range' as const,
        records: [],
        hasMore: false,
        limit: 25,
      })),
      queryNextConfirmedCalendarAppointment: jest.fn(async () => ({
        status: 'no_confirmed_upcoming_calendar_appointment' as const,
        appointment: null,
      })),
      queryTranscriptEvidence: jest.fn(async () => ({
        status: 'no_local_records_in_range' as const,
        records: [],
        hasMore: false,
        limit: 25,
        staleArtifacts: [],
        staleArtifactsHaveMore: false,
      })),
    } satisfies LocalRecordQueryStorage<typeof observation, unknown, unknown, unknown, unknown>;
    const memoryHit: LocalMemoryHit = {
      id: 'memory-1',
      text: 'Uses a weekly organizer.',
      score: 0.91,
      kind: 'preference',
      provenance: {
        sourceIds: ['recording-1'],
        sourceDates: [{ sourceId: 'recording-1', date: '2026-09-29' }],
        reviewState: 'user_confirmed',
      },
      createdAt: 1790659200000,
    };
    const memory: LocalMemoryReader = {
      recall: jest.fn(async () => [memoryHit]),
    };
    const service = createLocalRecordQueryService(storage, memory);
    const [health, medications, doses, appointment, transcript, memoryTool] =
      createLocalRecordQueryTools(service);

    const healthResult = JSON.parse(
      await health.invoke({ fromInclusive, toExclusive, type: 'heart_rate', limit: 2 }),
    ) as { records: (typeof observation)[] };
    expect(storage.queryHealthObservations).toHaveBeenCalledWith({
      fromInclusive,
      toExclusive,
      type: 'heart_rate',
      limit: 2,
    });
    expect(healthResult.records[0]).toMatchObject({
      value: { amount: 72, unit: 'count/min' },
      provenance: { sourceRecordIds: ['healthkit-sample-1'] },
    });
    await expect(medications.invoke({ fromInclusive, toExclusive })).resolves.toContain(
      'local_ingest',
    );
    await expect(doses.invoke({ fromInclusive, toExclusive })).resolves.toContain(
      'no_local_records_in_range',
    );
    await expect(appointment.invoke({ afterInclusive: toExclusive })).resolves.toContain(
      'no_confirmed_upcoming_calendar_appointment',
    );
    await expect(
      transcript.invoke({ recordingSourceId: 'recording-1', fromInclusive, toExclusive }),
    ).resolves.toContain('staleArtifacts');

    const memoryResult = JSON.parse(
      await memoryTool.invoke({ query: 'medicine routine', limit: 1 }),
    ) as { hits: LocalMemoryHit[] };
    expect(memory.recall).toHaveBeenCalledWith('medicine routine', { limit: 1 });
    expect(memoryResult.hits[0]).toMatchObject({
      provenance: {
        sourceIds: ['recording-1'],
        sourceDates: [{ sourceId: 'recording-1', date: '2026-09-29' }],
        reviewState: 'user_confirmed',
      },
    });
  });

  it('rejects widening tool arguments and distinguishes an unconfigured memory store', async () => {
    const storage = {
      queryHealthObservations: jest.fn(),
      queryImportedMedicationDefinitions: jest.fn(),
      queryImportedDoseEvents: jest.fn(),
      queryNextConfirmedCalendarAppointment: jest.fn(),
      queryTranscriptEvidence: jest.fn(),
    } as unknown as LocalRecordQueryStorage<unknown, unknown, unknown, unknown, unknown>;
    const service = createLocalRecordQueryService(storage);
    const [health, , , , , memory] = createLocalRecordQueryTools(service);

    await expect(
      health.invoke({ fromInclusive, toExclusive, type: 'heart_rate', sql: 'SELECT *' }),
    ).rejects.toThrow('expected schema');
    await expect(memory.invoke({ query: 'medication' })).resolves.toContain(
      'local_memory_unavailable',
    );
  });
});
