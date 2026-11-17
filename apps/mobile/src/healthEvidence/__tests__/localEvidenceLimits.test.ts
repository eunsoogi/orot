import { createRecordRepository, runMigrations } from '@orot/storage';
import type { SqlDatabase } from '@orot/storage';
import { createLocalHealthEvidenceRepository } from '../localEvidenceRepository';
import { createHealthEvidenceTestDatabase } from '../localEvidenceTestSupport';

const timestamp = '2026-10-07T00:00:00.000Z';

function sourceRecord(id: string, title: string, hashSuffix: string) {
  return {
    id,
    effectiveAt: timestamp,
    recordedAt: timestamp,
    ingestedAt: timestamp,
    provenance: { origin: 'imported' as const, sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' as const },
    sourceKind: 'other' as const,
    title,
    contentHash: `sha256:${hashSuffix.repeat(64)}`,
  };
}

function evidenceSpan(id: string, sourceRecordId: string) {
  return {
    id,
    effectiveAt: timestamp,
    recordedAt: timestamp,
    ingestedAt: timestamp,
    provenance: {
      origin: 'derived' as const,
      sourceRecordIds: [sourceRecordId],
    },
    reviewState: { status: 'unreviewed' as const },
    sourceRecordId,
    text: `Synthetic evidence ${id}.`,
    locator: { kind: 'text_range' as const, startOffset: 0, endOffset: 10 },
  };
}

describe('local health evidence query limits', () => {
  let database: SqlDatabase;
  let close: () => void;

  beforeEach(async () => {
    const opened = createHealthEvidenceTestDatabase();
    database = opened.database;
    close = opened.close;
    await runMigrations(database);
  });

  afterEach(() => close());

  it('retains a valid stored record beyond the former byte ceiling', async () => {
    const records = createRecordRepository(database);
    await records.sourceRecords.create(
      sourceRecord('large-source', 'x'.repeat(16 * 1024 + 1), 'a'),
    );

    const inventory =
      await createLocalHealthEvidenceRepository(database).readInventory();

    expect(inventory.inventoryComplete).toBe(true);
    expect(inventory.truncatedKinds).toEqual([]);
    expect(inventory.records).toHaveLength(1);
  });

  it('charges the exact source against per-kind and total row caps', async () => {
    const records = createRecordRepository(database);
    await records.sourceRecords.create(
      sourceRecord('source-a', 'Synthetic source', 'a'),
    );
    const createLinkedSource = async (index: number) =>
      records.sourceRecords.create({
        ...sourceRecord(
          `source-child-${index.toString().padStart(3, '0')}`,
          'Synthetic child',
          'b',
        ),
        contentHash: `sha256:${index.toString(16).padStart(64, '0')}`,
        provenance: {
          origin: 'user_reported' as const,
          sourceRecordIds: ['source-a'],
        },
      });
    await createLinkedSource(0);
    const adapter = createLocalHealthEvidenceRepository(database);

    const oneRowKind = await adapter.querySource('source-a', {
      rowsPerKind: 1,
      totalRows: 10,
    });
    const oneRowSources = oneRowKind.records.filter(
      ({ kind }) => kind === 'source_record',
    );
    // The exact source and linked siblings share the source_record allowance.
    expect(oneRowSources).toHaveLength(1);
    expect(oneRowKind.truncatedKinds).toContain('source_record');
    expect(oneRowKind.complete).toBe(false);

    for (let index = 1; index < 100; index += 1) {
      await createLinkedSource(index);
    }
    const maxRowKind = await adapter.querySource('source-a', {
      rowsPerKind: 100,
      totalRows: 400,
    });
    const maxRowSources = maxRowKind.records.filter(
      ({ kind }) => kind === 'source_record',
    );
    expect(maxRowSources).toHaveLength(100);
    expect(maxRowKind.truncatedKinds).toContain('source_record');
    expect(maxRowKind.complete).toBe(false);

    const oneTotalRow = await adapter.querySource('source-a', {
      rowsPerKind: 100,
      totalRows: 1,
    });
    expect(oneTotalRow.records).toHaveLength(1);
    expect(oneTotalRow.truncatedKinds).toContain('source_record');
    expect(oneTotalRow.complete).toBe(false);
  });

  it('honors explicit source selection without imposing a public maximum', async () => {
    const records = createRecordRepository(database);
    await records.sourceRecords.create(
      sourceRecord('source-a', 'Synthetic source', 'b'),
    );
    await records.evidenceSpans.create(evidenceSpan('span-a', 'source-a'));
    await records.evidenceSpans.create(evidenceSpan('span-b', 'source-a'));
    const adapter = createLocalHealthEvidenceRepository(database);

    const result = await adapter.querySource('source-a', {
      rowsPerKind: 1,
      totalRows: 10,
    });

    expect(result.records.map(({ kind }) => kind)).toEqual([
      'source_record',
      'evidence_span',
    ]);
    expect(result.complete).toBe(false);
    expect(result.truncatedKinds).toEqual(['evidence_span']);
    await expect(
      adapter.readInventory({
        rowsPerKind: 100 + 1,
      }),
    ).resolves.toMatchObject({ inventoryComplete: true });
  });
  it('pages through more than the former total and per-kind quotas', async () => {
    const records = createRecordRepository(database);
    await records.sourceRecords.create(
      sourceRecord('source-a', 'Synthetic source', 'c'),
    );
    for (let index = 0; index < 405; index += 1) {
      await records.evidenceSpans.create(
        evidenceSpan(`span-${String(index).padStart(3, '0')}`, 'source-a'),
      );
    }
    const adapter = createLocalHealthEvidenceRepository(database);
    const inventory = await adapter.readInventory();
    const linked = await adapter.querySource('source-a');
    expect(inventory.inventoryComplete).toBe(true);
    expect(inventory.records).toHaveLength(406);
    expect(linked.complete).toBe(true);
    expect(linked.records).toHaveLength(406);
    const abort = new AbortController();
    const cancellable: SqlDatabase = {
      execute: database.execute,
      transaction: operation =>
        database.transaction(tx =>
          operation({
            ...tx,
            execute: async (sql, parameters = []) => {
              const page = await tx.execute(sql, parameters);
              if (sql.includes('OFFSET ?') && parameters.at(-1) === 100)
                abort.abort();
              return page;
            },
          }),
        ),
    };
    await expect(
      createLocalHealthEvidenceRepository(cancellable).readInventory({
        signal: abort.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
