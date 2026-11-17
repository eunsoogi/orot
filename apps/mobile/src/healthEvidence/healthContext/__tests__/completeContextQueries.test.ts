import { createRecordRepository, runMigrations } from '@orot/storage';
import type { SqlExecutor } from '@orot/storage';
import {
  healthObservation,
  medicationDefinition,
} from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { createHealthEvidenceTestDatabase } from '../../localEvidenceTestSupport';
import { readHealthQuantityContext } from '../quantityQuery';
import { readHealthMedicationContext } from '../medicationQuery';
import { readHealthSymptomContext } from '../symptomQuery';
import { readHealthSleepContext } from '../sleepQuery';
import { addHeartRateActivityContext } from '../heartRateActivity';
import type { HealthContextDay } from '../types';

// Calendar fixtures deliberately exceed the old 90-day and 999-variable ceilings.
const days: HealthContextDay[] = Array.from({ length: 400 }, (_, index) => {
  const start = new Date(Date.UTC(2026, 0, index + 1));
  return {
    date: start.toISOString().slice(0, 10),
    fromInclusive: start.toISOString(),
    toExclusive: new Date(start.getTime() + 86400000).toISOString(),
    partial: false,
  };
});
const window = {
  fromInclusive: days[0]!.fromInclusive,
  toExclusive: days.at(-1)!.toExclusive,
  timeZone: 'UTC',
};

test('preserves all selected series, medicines and complete symptom text with constant calendar bind count', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const records = createRecordRepository(database);
    for (let i = 0; i < 15; i++) {
      const row = healthObservation(
        `heart-${i}`,
        'heart_rate',
        '2026-10-01T10:00:00Z',
      );
      await records.put('health_observation', {
        ...row,
        provenance: {
          ...row.provenance,
          source: { system: 'healthkit', sourceIdentifier: `sensor-${i}` },
        },
      });
    }
    for (let i = 0; i < 35; i++)
      await records.put(
        'medication_definition',
        medicationDefinition(`medicine-${i}`, '2026-01-01T00:00:00Z'),
      );
    const description = 'Complete synthetic symptom. '.repeat(60).trim();
    for (let i = 0; i < 9; i++)
      await records.put('symptom_entry', {
        id: `symptom-${i}`,
        status: 'active',
        effectiveAt: '2026-10-01T10:00:00Z',
        recordedAt: '2026-10-01T10:00:00Z',
        ingestedAt: '2026-10-01T10:00:00Z',
        provenance: { origin: 'user_reported', sourceRecordIds: [] },
        reviewState: { status: 'unreviewed' },
        description,
        severity: i,
      });
    const calendarBindings: number[] = [];
    const executor: SqlExecutor = {
      execute: (sql, parameters = []) => {
        if (sql.includes('WITH days(')) {
          expect(sql).toContain('json_each(?)');
          calendarBindings.push(parameters.length);
        }
        return database.execute(sql, parameters);
      },
    };
    const quantities = await readHealthQuantityContext(executor, days);
    expect(quantities.series).toHaveLength(15);
    expect(quantities.truncated).toBe(false);
    const enriched = await addHeartRateActivityContext(
      executor,
      days,
      quantities.series,
    );
    expect(enriched).toHaveLength(15);
    expect(enriched.every(series => series.days[0]?.samples === 1)).toBe(true);
    const medicines = await readHealthMedicationContext(executor, window);
    expect(medicines.medications).toHaveLength(35);
    expect(medicines.truncated).toBe(false);
    const symptoms = await readHealthSymptomContext(executor, days);
    expect(symptoms.entryCount).toBe(9);
    expect(symptoms.latest).toHaveLength(9);
    expect(symptoms.latest.every(row => row.description === description)).toBe(
      true,
    );
    await readHealthSleepContext(executor, days);
    expect(calendarBindings).toHaveLength(5);
    expect(Math.max(...calendarBindings)).toBeLessThan(20);
    await records.delete('symptom_entry', 'symptom-8');
    expect(
      (await readHealthSymptomContext(executor, days)).latest,
    ).toHaveLength(8);
  } finally {
    close();
  }
});
