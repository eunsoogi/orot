import {
  createRecordRepository,
  runMigrations,
  STORAGE_TABLES,
} from '@orot/storage';
import type { SqlDatabase, SqlTransaction } from '@orot/storage';
import { assessHealthEvidenceCoverage } from '../coverage';
import { createLocalHealthEvidenceRepository } from '../localEvidenceRepository';
import { createHealthEvidenceTestDatabase } from '../localEvidenceTestSupport';

const timestamp = '2026-10-07T00:00:00.000Z';

function sourceRecord(id: string, suffix: string) {
  return {
    id,
    effectiveAt: timestamp,
    recordedAt: timestamp,
    ingestedAt: timestamp,
    provenance: { origin: 'imported' as const, sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' as const },
    sourceKind: 'other' as const,
    title: 'Synthetic source',
    contentHash: `sha256:${suffix.repeat(64)}`,
  };
}

function symptomEntry(id: string, sourceId: string) {
  return {
    id,
    effectiveAt: timestamp,
    recordedAt: timestamp,
    ingestedAt: timestamp,
    provenance: { origin: 'derived' as const, sourceRecordIds: [sourceId] },
    reviewState: { status: 'unreviewed' as const },
    description: 'Synthetic mild headache',
  };
}

describe('bounded local health evidence repository', () => {
  let database: SqlDatabase;
  let close: () => void;
  let repository: ReturnType<typeof createRecordRepository>;

  beforeEach(async () => {
    const opened = createHealthEvidenceTestDatabase();
    database = opened.database;
    close = opened.close;
    await runMigrations(database);
    repository = createRecordRepository(database);
  });

  afterEach(() => close());

  it('queries every public record kind and keeps duplicate IDs as kind-scoped records', async () => {
    await repository.sourceRecords.create(sourceRecord('shared-id', 'a'));
    await repository.put(
      'symptom_entry',
      symptomEntry('shared-id', 'shared-id'),
    );
    const statements: Array<{ query: string; parameters: readonly unknown[] }> =
      [];
    const tracked: SqlDatabase = {
      execute: (query, parameters = []) => {
        statements.push({ query, parameters });
        return database.execute(query, parameters);
      },
      transaction: operation =>
        database.transaction(transaction =>
          operation(trackTransaction(transaction, statements)),
        ),
    };

    const snapshot = await createLocalHealthEvidenceRepository(
      tracked,
    ).readInventory({
      rowsPerKind: 1,
      totalRows: 10,
    });

    expect(snapshot.inventoryComplete).toBe(true);
    expect(assessHealthEvidenceCoverage(snapshot)).toEqual({
      status: 'complete',
    });
    expect(snapshot.queriedKinds).toEqual(Object.keys(STORAGE_TABLES));
    expect(
      snapshot.records.map(({ kind, record }) => [kind, record.id]),
    ).toEqual([
      ['source_record', 'shared-id'],
      ['symptom_entry', 'shared-id'],
    ]);
    const exactReader = createLocalHealthEvidenceRepository(database);
    expect(
      await exactReader.readRecord('source_record', 'shared-id'),
    ).toMatchObject({ sourceKind: 'other' });
    expect(
      await exactReader.readRecord('symptom_entry', 'shared-id'),
    ).toMatchObject({ description: 'Synthetic mild headache' });
    expect(statements).toHaveLength(Object.keys(STORAGE_TABLES).length);
    expect(statements.every(({ query }) => /LIMIT \?/.test(query))).toBe(true);
    expect(statements.every(({ parameters }) => parameters.at(-1) === 2)).toBe(
      true,
    );
  });

  it('follows exact source IDs through duplicate re-import and deletion', async () => {
    const original = sourceRecord('source-a', 'b');
    await repository.sourceRecords.create(original);
    await repository.evidenceSpans.create({
      id: 'span-a',
      effectiveAt: timestamp,
      recordedAt: timestamp,
      ingestedAt: timestamp,
      provenance: { origin: 'derived', sourceRecordIds: ['source-a'] },
      reviewState: { status: 'unreviewed' },
      sourceRecordId: 'source-a',
      text: 'Synthetic excerpt.',
      locator: { kind: 'text_range', startOffset: 0, endOffset: 18 },
    });
    await repository.sourceRecords.create({
      ...sourceRecord('source-child', 'c'),
      provenance: { origin: 'user_reported', sourceRecordIds: ['source-a'] },
    });

    const duplicate = await repository.sourceRecords.create({
      ...original,
      id: 'source-b',
      title: 'Duplicate import',
    });
    const beforeDelete =
      await createLocalHealthEvidenceRepository(database).querySource(
        'source-a',
      );
    expect(duplicate.id).toBe('source-a');
    expect(beforeDelete.status).toBe('available');
    expect(
      beforeDelete.records.map(({ kind, record }) => [kind, record.id]),
    ).toEqual([
      ['source_record', 'source-a'],
      ['source_record', 'source-child'],
      ['evidence_span', 'span-a'],
    ]);

    expect(await repository.sourceRecords.delete('source-a')).toBe(true);
    expect(
      await createLocalHealthEvidenceRepository(database).querySource(
        'source-a',
      ),
    ).toMatchObject({
      status: 'source_missing',
      records: [],
    });
    const reimported = await repository.sourceRecords.create(
      sourceRecord('source-c', 'b'),
    );
    expect(reimported.id).toBe('source-c');
    expect(
      (
        await createLocalHealthEvidenceRepository(database).querySource(
          'source-c',
        )
      ).records.map(({ kind }) => kind),
    ).toEqual(['source_record']);
  });

  it('reports row caps as incomplete and never returns more than the requested bound', async () => {
    await repository.sourceRecords.create(sourceRecord('source-a', 'c'));
    await repository.sourceRecords.create(sourceRecord('source-b', 'd'));
    const statements: string[] = [];
    const tracked: SqlDatabase = {
      execute: database.execute,
      transaction: operation =>
        database.transaction(transaction =>
          operation({
            ...transaction,
            execute: (query, parameters = []) => {
              statements.push(query);
              return transaction.execute(query, parameters);
            },
          }),
        ),
    };

    const snapshot = await createLocalHealthEvidenceRepository(
      tracked,
    ).readInventory({
      rowsPerKind: 1,
      totalRows: 2,
    });

    expect(snapshot.records).toHaveLength(1);
    expect(snapshot.inventoryComplete).toBe(false);
    expect(assessHealthEvidenceCoverage(snapshot)).toEqual({
      status: 'unavailable',
    });
    expect(snapshot.truncatedKinds).toContain('source_record');
    expect(statements[0]).toContain('LIMIT ?');
  });

  it('stops after cancellation and discards the in-flight query result', async () => {
    const controller = new AbortController();
    let queryCount = 0;
    const cancellable: SqlDatabase = {
      execute: database.execute,
      transaction: operation =>
        database.transaction(transaction =>
          operation({
            ...transaction,
            async execute(query, parameters = []) {
              queryCount += 1;
              const result = await transaction.execute(query, parameters);
              controller.abort();
              return result;
            },
          }),
        ),
    };

    await expect(
      createLocalHealthEvidenceRepository(cancellable).readInventory({
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(queryCount).toBe(1);
  });
});

function trackTransaction(
  transaction: SqlTransaction,
  statements: Array<{ query: string; parameters: readonly unknown[] }>,
): SqlTransaction {
  return {
    ...transaction,
    execute: (query, parameters = []) => {
      statements.push({ query, parameters });
      return transaction.execute(query, parameters);
    },
  };
}
