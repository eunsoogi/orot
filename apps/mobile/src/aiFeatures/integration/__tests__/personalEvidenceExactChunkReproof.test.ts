import {
  createRecordRepository,
  runMigrations,
  type SqlDatabase,
  type SqlExecutor,
} from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { readCurrentEvidenceChunks } from '../../../healthEvidence/currentEvidenceChunks';
import type { EvidenceRecordIdentity } from '../../../healthEvidence/currentEvidenceChunks';
import { createLocalHealthEvidenceRepository } from '../../../healthEvidence/localEvidenceRepository';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { buildPersonalEvidence } from '../personalEvidence';
import {
  healthObservation,
  noStaleEvidence,
  referenceOnly,
} from '../testSupport/personalEvidenceTestSupport';

test('freshness reads grouped cited identities, never uncited candidates or a prior pass', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    const database = connection.database;
    await runMigrations(database);
    const writer = createRecordRepository(database);
    const repository = createLocalHealthEvidenceRepository(database);
    const observations = Array.from({ length: 40 }, (_, i) =>
      healthObservation(`synthetic-${i}`, []),
    );
    const at = '2026-01-02T08:00:00.000Z';
    const encounter = {
      kind: 'encounter' as const,
      record: {
        id: 'synthetic-0',
        effectiveAt: at,
        recordedAt: at,
        ingestedAt: at,
        encounterKind: 'outpatient' as const,
        summary: 'Synthetic typed identity collision.',
        provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
        reviewState: { status: 'unreviewed' as const },
      },
    };
    for (const candidate of observations) {
      if (candidate.kind !== 'health_observation')
        throw new Error('Invalid fixture');
      await writer.put(candidate.kind, candidate.record);
    }
    await writer.put(encounter.kind, encounter.record);
    const records = [...observations, encounter];
    const full = records.map(value => ({
      kind: value.kind,
      id: value.record.id,
    }));
    const cited = [full[0]!, full[40]!];
    const initial = await readCurrentEvidenceChunks(database, full);
    let reads = 0;
    let terminate: (() => void) | undefined;
    const count: SqlExecutor['execute'] = async (sql, parameters) => {
      reads += 1;
      return database.execute(sql, parameters);
    };
    const counted: SqlDatabase = {
      execute: count,
      transaction: fn =>
        database.transaction(tx =>
          fn({
            ...tx,
            execute: async (sql, parameters) => {
              reads += 1;
              const result = await tx.execute(sql, parameters);
              terminate?.();
              return result;
            },
          }),
        ),
    };
    const selected = jest.fn(
      (ids: readonly EvidenceRecordIdentity[], signal: AbortSignal) =>
        readCurrentEvidenceChunks(counted, ids, signal),
    );
    const bulk = jest.fn(() => readCurrentEvidenceChunks(counted, full));
    const fixture = (exact: boolean) => {
      const registry = new LocalEvidenceReferenceRegistry();
      const result = buildPersonalEvidence({
        records,
        persistedChunks: initial,
        registry,
        repository,
        ...noStaleEvidence,
        loadCurrentPersistedChunks: bulk,
        ...(exact ? { loadCurrentPersistedChunksFor: selected } : {}),
      });
      return {
        registry,
        refs: [result.items[0]!, result.items[40]!].map(referenceOnly),
      };
    };
    const optimized = fixture(true);
    const legacy = fixture(false);
    const signal = new AbortController().signal;
    expect(await legacy.registry.revalidateEvidence(legacy.refs, signal)).toBe(
      true,
    );
    expect(reads).toBe(41);
    expect(bulk).toHaveBeenCalledTimes(1);
    reads = 0;
    expect(
      await optimized.registry.revalidateEvidence(optimized.refs, signal),
    ).toBe(true);
    expect(selected).toHaveBeenCalledTimes(1);
    expect(selected).toHaveBeenCalledWith(cited, signal);
    expect(reads).toBe(2);
    expect(bulk).toHaveBeenCalledTimes(1);
    const mixed = buildPersonalEvidence({
      records: [observations[4]!],
      persistedChunks: initial,
      registry: optimized.registry,
      repository,
      ...noStaleEvidence,
      loadCurrentPersistedChunks: bulk,
    });
    reads = 0;
    expect(
      await optimized.registry.revalidateEvidence(
        [...optimized.refs, referenceOnly(mixed.items[0]!)],
        signal,
      ),
    ).toBe(true);
    expect(selected).toHaveBeenLastCalledWith(cited, signal);
    expect(bulk).toHaveBeenCalledTimes(2);
    expect(reads).toBe(43);
    reads = 0;
    const cancelled = new AbortController();
    terminate = () => cancelled.abort();
    expect(
      await optimized.registry.revalidateEvidence(
        optimized.refs,
        cancelled.signal,
      ),
    ).toBe(false);
    expect(reads).toBe(1);
    terminate = undefined;
    await writer.delete('encounter', encounter.record.id);
    expect(
      await optimized.registry.revalidateEvidence(optimized.refs, signal),
    ).toBe(false);
  } finally {
    connection.close();
  }
});
