import { createRecordRepository, runMigrations } from '@orot/storage';
import {
  healthObservation,
  medicationDefinition,
  importedDoseEvent,
} from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { createHealthEvidenceTestDatabase } from '../../localEvidenceTestSupport';
import { createHealthContextReader } from '../reader';

const window = {
  fromInclusive: '2026-10-01T00:00:00Z',
  toExclusive: '2026-10-05T00:00:00Z',
  timeZone: 'UTC',
};

test('keeps the current medication catalog separate from dose events and does not invent missed doses', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const records = createRecordRepository(database);
    await records.put('medication_definition', {
      ...medicationDefinition('medication-1', '2026-09-01T00:00:00Z'),
      displayText: 'Synthetic daily medicine',
    });
    await records.put(
      'dose_event',
      importedDoseEvent('taken', '2026-10-01T01:00:00Z', 'taken'),
    );
    await records.put(
      'dose_event',
      importedDoseEvent('skipped', '2026-10-01T02:00:00Z', 'skipped'),
    );
    const read = createHealthContextReader(database);
    const report = await read(window, ['medications']);
    expect(report.medications[0]).toMatchObject({
      name: 'Synthetic daily medicine',
      scheduleRegistered: true,
      taken: 1,
      skipped: 1,
      otherDoseRecords: 0,
      daysWithDoseRecords: 1,
    });
    // Four requested days do not turn the other three days into missed-dose events.
    expect(report.medications[0]?.skipped).toBe(1);
    expect(report.quantities).toHaveLength(0);
  } finally {
    close();
  }
});

test('reuses bounded reports only until a real mutation and fences even numerically unchanged deletion', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const records = createRecordRepository(database);
    const read = createHealthContextReader(database);
    const first = await read(window, ['measurements']);
    expect((await database.execute('PRAGMA temp_store')).rows[0]).toEqual({
      temp_store: 2,
    });
    expect(await read(window, ['measurements'])).toBe(first);
    await records.put(
      'health_observation',
      healthObservation('one', 'heart_rate', '2026-10-01T01:00:00Z'),
    );
    const inserted = await read(window, ['measurements']);
    expect(inserted.mutationGeneration).toBeGreaterThan(
      first.mutationGeneration,
    );
    expect(inserted.quantities[0]?.days[0]?.samples).toBe(1);
    await records.delete('health_observation', 'one');
    const deleted = await read(window, ['measurements']);
    expect(deleted.deletionGeneration).toBeGreaterThan(
      inserted.deletionGeneration,
    );
    expect(deleted.quantities).toHaveLength(0);
  } finally {
    close();
  }
});
