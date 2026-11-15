import { dailyReportActions } from '../../../aiFeatures/integration/dailyReportActions';
import {
  DoseEventSchema,
  MedicationDefinitionSchema,
  DailyReportContextSchema,
} from '@orot/domain';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { readDailyReportSnapshot } from '../dailyReportSnapshot';
import { createDailyReportCalendarWindow } from '../dailyReportWindow';
import { createDailyReportContext } from '../dailyReportContext';
import { dailyReportFacts } from '../../../aiFeatures/integration/dailyReportFacts';

const provenance = { origin: 'user_reported', sourceRecordIds: [] };
const medicine = MedicationDefinitionSchema.parse({
  id: 'med',
  medicationConceptIdentifier: 'concept',
  displayText: 'Synthetic medicine',
  generalForm: 'tablet',
  isArchived: false,
  hasSchedule: true,
  ingestedAt: '2034-12-01T00:00:00Z',
  provenance,
  reviewState: { status: 'unreviewed' },
});
const dose = DoseEventSchema.parse({
  id: 'dose',
  eventKind: 'observed',
  medicationDefinitionId: 'med',
  observationStatus: 'taken',
  effectiveAt: '2035-01-01T01:00:00Z',
  ingestedAt: '2035-01-01T01:00:00Z',
  provenance,
  reviewState: { status: 'unreviewed' },
});

test('links old medication identity without pretending it occurred today, and preserves scope/cutoff/fences', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const repository = createRecordRepository(connection.database);
    await repository.put('medication_definition', medicine);
    await repository.put('dose_event', dose);
    const day = createDailyReportCalendarWindow({
      localDate: '2035-01-01',
      timeZone: 'UTC',
      requestedAt: '2035-01-01T12:00:00Z',
    });
    if (day.status !== 'ready') throw new Error('fixture');
    const read = () =>
      readDailyReportSnapshot(connection.database, day.context, {});
    const result = await read();
    expect(result.values.map(x => x.kind)).toEqual([
      'dose_event',
      'medication_definition',
    ]);
    expect(result.sourceSnapshot.records[1]).toMatchObject({
      occurrence: { startInclusive: '2034-12-01T00:00:00Z' },
      supportingRecordFor: ['dose'],
    });
    const context = createDailyReportContext(
      day.context,
      result.sourceSnapshot,
      { providerId: 'fake', modelId: 'fake' },
    );
    const facts = dailyReportFacts(
      result.values,
      result.sourceSnapshot.records,
    );
    expect(facts[0]?.text).toContain('Synthetic medicine');
    const action = dailyReportActions(
      result.values,
      result.sourceSnapshot.records,
    )[0]!;
    expect(action.text).toContain('Synthetic medicine');
    expect(action.sourceReferences).toHaveLength(2);
    expect(facts[0]?.sourceReferences).toHaveLength(2);
    expect(facts[1]?.text).toContain('현재 사용을 판단하지');
    const detached = {
      ...context,
      sourceSnapshot: {
        ...context.sourceSnapshot,
        records: [context.sourceSnapshot.records[1]],
      },
    };
    expect(DailyReportContextSchema.safeParse(detached).success).toBe(false);
    const scoped = await readDailyReportSnapshot(
      connection.database,
      day.context,
      { sourceIds: ['dose'] },
    );
    expect(scoped.values).toHaveLength(1);
    expect(
      scoped.sourceSnapshot.coverage.find(x => x.source === 'dose_event')
        ?.limitationCodes,
    ).toContain('medication_names_not_resolved');
    await repository.put('medication_definition', {
      ...medicine,
      displayText: 'Corrected synthetic name',
    });
    const changed = await read();
    expect(changed.sourceSnapshot.revision).not.toBe(
      result.sourceSnapshot.revision,
    );
    expect(changed.lineage[1]?.revision).not.toBe(result.lineage[1]?.revision);
    await repository.put('medication_definition', {
      ...medicine,
      ingestedAt: '2035-01-01T12:01:00Z',
    });
    expect((await read()).values).toHaveLength(1);
    await connection.database.execute(
      'DELETE FROM medication_definitions WHERE id = ?',
      ['med'],
    );
    const deleted = await read();
    expect(deleted.values).toHaveLength(1);
    expect(deleted.sourceSnapshot.deletionGeneration).toBeGreaterThan(
      result.sourceSnapshot.deletionGeneration,
    );
  } finally {
    connection.close();
  }
});
