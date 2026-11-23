import {
  createRecordRepository,
  runMigrations,
  type SqlDatabase,
} from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../../../healthEvidence/localEvidenceTestSupport';
import {
  bindSelectedCurrentEvidenceChunks,
  createLocalEvidenceData,
} from '../../../healthEvidence/localEvidenceData';
import { createLocalHealthEvidenceRepository } from '../../../healthEvidence/localEvidenceRepository';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { toolsFor } from '../featureServiceExecution';
import type { AiFeatureLocalData } from '../localData';

test('ordinary personal-record tool revalidates cited protected chunks without walking uncited candidates', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const writer = createRecordRepository(database);
    const at = '2026-10-18T00:00:00.000Z';
    const fixture = Array.from({ length: 32 }, (_, index) => ({
      id: `fixture-symptom-${String(index).padStart(2, '0')}`,
      status: 'active' as const,
      effectiveAt: at,
      ingestedAt: at,
      recordedAt: at,
      provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' as const },
      description: 'Synthetic archived fixture keyword curio.',
    }));
    for (const row of fixture) await writer.put('symptom_entry', row);
    const chunkIds: unknown[] = [];
    const instrumented: SqlDatabase = {
      execute: (sql, args) => database.execute(sql, args),
      transaction: work =>
        database.transaction(tx =>
          work({
            ...tx,
            execute(sql, args) {
              if (
                /AS payload_bytes\s+FROM symptom_entries r WHERE r.id = \?/u.test(
                  sql,
                )
              )
                chunkIds.push(args?.[0]);
              return tx.execute(sql, args);
            },
          }),
        ),
    };
    const canonical = createLocalEvidenceData(instrumented);
    const data: AiFeatureLocalData = {
      ...canonical,
      repository: createLocalHealthEvidenceRepository(database),
      memoryStorage: { listRecords: async () => [] },
      loadMemoryRecords: async () => [],
      rag: {
        index: jest.fn(async () => {}),
        search: jest.fn(async (_q, chunks) =>
          chunks.map(chunk => ({
            chunk,
            score: 1,
            lexicalRank: 1,
            vectorRank: 1,
          })),
        ),
      },
    };
    const owned = new LocalEvidenceReferenceRegistry();
    const legacy = new LocalEvidenceReferenceRegistry();
    const signal = new AbortController().signal;
    const raw = (
      input: AiFeatureLocalData,
      registry: LocalEvidenceReferenceRegistry,
    ) =>
      toolsFor(undefined, input, registry, 6, true, 'rag')
        .find(candidate => candidate.id === 'local-personal-records')!
        .search({
          operationRunId: 'synthetic-cited-reproof',
          operationKey: 'tool-1',
          input: { query: 'curio' },
          allowedScope: { sourceKinds: ['personal_record'] },
          resultLimit: 6,
          maxPayloadBytes: 64 * 1024,
          signal,
        });
    const exact = await raw(data, owned);
    // A custom forwarding port is intentionally not a canonical protected reader.
    const fallback = await raw(
      {
        ...data,
        loadCurrentChunks: (...args) => canonical.loadCurrentChunks(...args),
      },
      legacy,
    );
    expect(exact).toEqual(fallback);
    if ('status' in exact || 'status' in fallback)
      throw new Error('Invalid fixture policy');
    const item = exact.items[0]!;
    const reference = owned.resolve(item)!;
    const ownId = reference.evidenceId;
    expect(fixture.some(row => row.id === ownId)).toBe(true);
    chunkIds.length = 0;
    expect(await legacy.revalidateEvidence([fallback.items[0]!], signal)).toBe(
      true,
    );
    expect(chunkIds).toHaveLength(4);
    const baselineCount = chunkIds.length;
    chunkIds.length = 0;
    expect(await owned.revalidateEvidence([item], signal)).toBe(true);
    expect(chunkIds).toEqual([ownId]);
    expect(baselineCount).toBeGreaterThan(chunkIds.length);
    expect(await owned.readSource(item, signal)).toMatchObject({
      status: 'available',
    });

    const selected = bindSelectedCurrentEvidenceChunks(data, [
      { kind: 'symptom_entry', id: ownId },
    ]);
    chunkIds.length = 0;
    expect(
      await selected?.([{ kind: 'encounter', id: ownId }], signal),
    ).toEqual([]);
    expect(chunkIds).toHaveLength(0);
    await writer.delete('symptom_entry', ownId);
    expect(await owned.revalidateEvidence([item], signal)).toBe(false);
  } finally {
    close();
  }
});
