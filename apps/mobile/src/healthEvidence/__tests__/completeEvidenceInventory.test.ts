import { createRecordRepository, runMigrations } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../localEvidenceTestSupport';
import { readCompleteEvidenceInventory } from '../completeEvidenceInventory';

describe('complete paged evidence inventory', () => {
  it('includes supporting medication records when unrelated health rows exceed one page', async () => {
    const { database, close } = createHealthEvidenceTestDatabase();
    try {
      await runMigrations(database);
      const records = createRecordRepository(database);
      const metadata = {
        ingestedAt: '2026-10-12T00:00:00.000Z',
        recordedAt: '2026-10-12T00:00:00.000Z',
        provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
        reviewState: { status: 'unreviewed' as const },
      };
      for (let index = 0; index < 110; index += 1) {
        await records.put('health_observation', {
          ...metadata,
          id: `heart-${index}`,
          effectiveAt: metadata.ingestedAt,
          observationKind: 'measurement',
          concept: 'heart_rate',
          value: { kind: 'quantity', amount: 70, unit: 'count/min' },
        });
      }
      await records.put('medication_definition', {
        ...metadata,
        id: 'medication-supported',
        displayText: '합성 약',
        medicationConceptIdentifier: 'synthetic-medication',
        generalForm: 'tablet',
        isArchived: false,
        hasSchedule: true,
      });
      const snapshot = await readCompleteEvidenceInventory(database);
      expect(snapshot.inventoryComplete).toBe(true);
      expect(snapshot.records).toHaveLength(111);
      expect(
        snapshot.records.some(row => row.record.id === 'medication-supported'),
      ).toBe(true);
    } finally {
      close();
    }
  });

  it('rejects a request cancelled before reading any records', async () => {
    const { database, close } = createHealthEvidenceTestDatabase();
    try {
      await runMigrations(database);
      const controller = new AbortController();
      controller.abort();
      await expect(
        readCompleteEvidenceInventory(database, controller.signal),
      ).rejects.toMatchObject({ name: 'AbortError' });
    } finally {
      close();
    }
  });
  it('yields between SQL pages so cancellation discards the partial inventory', async () => {
    const { database, close } = createHealthEvidenceTestDatabase();
    try {
      await runMigrations(database);
      const rows = Array.from({ length: 101 }, (_, index) => ({
        id: `paged-${index.toString().padStart(3, '0')}`,
        ingestedAt: '2026-10-12T00:00:00Z',
        recordedAt: '2026-10-12T00:00:00Z',
        provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
        reviewState: { status: 'unreviewed' as const },
        displayText: '합성 약',
        medicationConceptIdentifier: 'synthetic',
        generalForm: 'tablet',
        isArchived: false,
        hasSchedule: true,
      }));
      const records = createRecordRepository(database);
      for (const row of rows) await records.put('medication_definition', row);
      const controller = new AbortController();
      let scheduled = false;
      const observed = {
        ...database,
        transaction: (run: Parameters<typeof database.transaction>[0]) =>
          database.transaction(tx =>
            run({
              ...tx,
              execute: async (sql, parameters) => {
                const result = await tx.execute(sql, parameters);
                if (result.rows.length === 100) {
                  scheduled = true;
                  setTimeout(() => controller.abort(), 0);
                }
                return result;
              },
            }),
          ),
      };
      await expect(
        readCompleteEvidenceInventory(observed, controller.signal),
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(scheduled).toBe(true);
    } finally {
      close();
    }
  });

  it('never declares an inventory complete when an oversized record was omitted', async () => {
    const { database, close } = createHealthEvidenceTestDatabase();
    try {
      await runMigrations(database);
      const row = {
        id: 'oversized',
        ingestedAt: '2026-10-12T00:00:00Z',
        recordedAt: '2026-10-12T00:00:00Z',
        provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
        reviewState: { status: 'unreviewed' as const },
        displayText: '합성 약',
        medicationConceptIdentifier: 'synthetic',
        generalForm: 'tablet',
        isArchived: false,
        hasSchedule: true,
      };
      await createRecordRepository(database).put('medication_definition', row);
      await database.execute(
        'UPDATE medication_definitions SET payload_json = ? WHERE id = ?',
        [JSON.stringify({ ...row, displayText: '합'.repeat(6000) }), row.id],
      );
      const snapshot = await readCompleteEvidenceInventory(database);
      expect(snapshot.inventoryComplete).toBe(false);
      expect(snapshot.truncatedKinds).toContain('medication_definition');
      expect(snapshot.records).toHaveLength(0);
    } finally {
      close();
    }
  });
});
