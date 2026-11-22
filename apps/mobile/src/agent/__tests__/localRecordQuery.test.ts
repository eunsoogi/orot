import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import type { SqlDatabase } from '@orot/storage';
import type { LocalMemoryHit, LocalMemoryReader } from '@orot/agent-runtime';
import { openLocalAgentMemoryDatabase } from '../../storage/secureDatabase';
import {
  openLocalRecordQueryService,
  openLocalRecordQueryTools,
} from '../localRecordQuery';

jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
}));

describe('mobile local record query adapter', () => {
  let database: ReturnType<typeof openSqliteTestDatabase>;

  beforeEach(async () => {
    jest.clearAllMocks();
    database = openSqliteTestDatabase(':memory:');
    await runMigrations(database.database);
    jest
      .mocked(openLocalAgentMemoryDatabase)
      .mockResolvedValue(database.database as SqlDatabase);
  });

  afterEach(() => database.close());

  it('queries records from the existing local database using the encrypted adapter boundary', async () => {
    const records = createRecordRepository(database.database);
    await records.put('health_observation', {
      id: 'mobile-query-heart-rate',
      effectiveAt: '2026-10-01T10:00:00.000Z',
      recordedAt: '2026-10-01T10:00:00.000Z',
      ingestedAt: '2026-10-01T10:01:00.000Z',
      provenance: {
        origin: 'imported',
        sourceRecordIds: ['healthkit-sample-mobile'],
        source: {
          system: 'healthkit',
          sourceIdentifier: 'com.example.synthetic',
        },
      },
      reviewState: { status: 'unreviewed' },
      observationKind: 'measurement',
      concept: 'heart_rate',
      value: { kind: 'quantity', amount: 72, unit: 'count/min' },
    });

    const service = await openLocalRecordQueryService();
    const result = await service.queryHealthObservations({
      type: 'heart_rate',
      fromInclusive: '2026-10-01T00:00:00Z',
      toExclusive: '2026-10-02T00:00:00Z',
    });

    expect(openLocalAgentMemoryDatabase).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: 'available',
      records: [
        {
          id: 'mobile-query-heart-rate',
          value: { amount: 72, unit: 'count/min' },
          provenance: { sourceRecordIds: ['healthkit-sample-mobile'] },
        },
      ],
    });
  });

  it('ranks an already-open memory reader once without growing the LangChain result', async () => {
    const hit: LocalMemoryHit = {
      id: 'mobile-memory-1',
      text: 'Prefers an evening reminder.',
      score: 0.9,
      kind: 'preference',
      provenance: {
        sourceIds: ['recording-mobile-1'],
        sourceDates: [{ sourceId: 'recording-mobile-1', date: '2026-09-30' }],
        reviewState: 'user_confirmed',
      },
      createdAt: 1790730000000,
    };
    // The ranking window is internal. The tool may expose neither its
    // local-only first hit nor an eligible hit beyond the caller's page.
    const ranked: LocalMemoryHit[] = [
      {
        ...hit,
        id: 'synthetic-local-only',
        text: 'Synthetic private note.',
        provenance: {
          sourceIds: ['conversation-local-memory:synthetic'],
          reviewState: 'user_confirmed',
        },
      },
      { ...hit, memoryKey: 'synthetic-durable-key' },
      { ...hit, id: 'synthetic-eligible-overflow', score: 0.8 },
    ];
    const memory: LocalMemoryReader = {
      recall: jest.fn(async (_query: string, options?: { limit?: number }) =>
        ranked.slice(0, options?.limit ?? ranked.length),
      ),
    };

    const tools = await openLocalRecordQueryTools(memory);
    const memoryTool = tools.find(
      item => item.name === 'search_source_linked_user_memory',
    );

    expect(tools.map(item => item.name)).toEqual([
      'query_imported_health_observations',
      'query_imported_medication_definitions',
      'query_imported_dose_events',
      'query_next_confirmed_calendar_appointment',
      'query_transcript_evidence',
      'search_source_linked_user_memory',
    ]);
    const output = await memoryTool?.invoke({ query: 'reminder', limit: 1 });
    if (typeof output !== 'string') throw new Error('Missing memory tool JSON');
    expect(JSON.parse(output)).toEqual({
      status: 'available',
      hits: [hit],
      limit: 1,
    });
    expect(memory.recall).toHaveBeenCalledTimes(1);
    expect(memory.recall).toHaveBeenCalledWith('reminder', { limit: 6 });
  });
});
