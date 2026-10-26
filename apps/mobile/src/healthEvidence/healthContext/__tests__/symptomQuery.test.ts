import { createRecordRepository, runMigrations } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../../localEvidenceTestSupport';
import { readHealthSymptomContext } from '../symptomQuery';
import { healthContextDays } from '../window';

test('preserves recorded numeric severity while bounding symptom coverage by occurrence time', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const records = createRecordRepository(database);
    for (const [id, effectiveAt, severity] of [
      ['inside', '2026-10-01T10:00:00Z', 3],
      ['outside', '2026-10-02T10:00:00Z', 9],
    ] as const) {
      await records.put('symptom_entry', {
        status: 'active',
        id,
        effectiveAt,
        recordedAt: effectiveAt,
        ingestedAt: '2026-10-20T00:00:00Z',
        provenance: { origin: 'user_reported', sourceRecordIds: [] },
        reviewState: { status: 'unreviewed' },
        description: 'Synthetic symptom',
        severity,
      });
    }
    const report = await readHealthSymptomContext(
      database,
      healthContextDays({
        fromInclusive: '2026-10-01T00:00:00Z',
        toExclusive: '2026-10-02T00:00:00Z',
        timeZone: 'UTC',
      }),
    );
    expect(report.entryCount).toBe(1);
    expect(report.recordedDays).toBe(1);
    expect(report.latest).toEqual([
      {
        effectiveAt: '2026-10-01T10:00:00Z',
        description: 'Synthetic symptom',
        severity: 3,
      },
    ]);
  } finally {
    close();
  }
});
