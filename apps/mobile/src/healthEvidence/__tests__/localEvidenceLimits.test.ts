import { createRecordRepository, runMigrations } from '@orot/storage';
import type { SqlDatabase } from '@orot/storage';
import {
  createLocalHealthEvidenceRepository,
  MAX_HEALTH_EVIDENCE_RECORD_BYTES,
  MAX_HEALTH_EVIDENCE_ROWS_PER_KIND,
} from '../localEvidenceRepository';
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

  it('marks an oversized stored record incomplete without returning its payload', async () => {
    const records = createRecordRepository(database);
    await records.sourceRecords.create(
      sourceRecord(
        'large-source',
        'x'.repeat(MAX_HEALTH_EVIDENCE_RECORD_BYTES + 1),
        'a',
      ),
    );

    const inventory =
      await createLocalHealthEvidenceRepository(database).readInventory();

    expect(inventory.inventoryComplete).toBe(false);
    expect(inventory.truncatedKinds).toContain('source_record');
    expect(inventory.records).toEqual([]);
  });

  it('bounds source-linked rows and rejects limits above the public cap', async () => {
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
        rowsPerKind: MAX_HEALTH_EVIDENCE_ROWS_PER_KIND + 1,
      }),
    ).rejects.toThrow('query limit');
  });
});
