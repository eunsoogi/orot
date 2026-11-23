import { dailyReportActions } from '../../../aiFeatures/integration/dailyReportActions';
import {
  DoseEventSchema,
  MedicationDefinitionSchema,
  DailyReportContextSchema,
} from '@orot/domain';
import { createRecordRepository, runMigrations } from '@orot/storage';
import type { SqlExecutor } from '@orot/storage';
import { readDailyReportMedicationContext } from '../dailyReportMedicationContext';
import type { LocalHealthEvidenceRecord } from '../../localEvidenceQueries';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { readDailyReportSnapshot } from '../dailyReportSnapshot';
import { createDailyReportCalendarWindow } from '../dailyReportWindow';
import { createDailyReportContext } from '../dailyReportContext';
import { dailyReportFacts } from '../../../aiFeatures/integration/dailyReportFacts';

const provenance = { origin: 'user_reported' as const, sourceRecordIds: [] };
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
    expect(facts[1]?.text).toContain('연결된 약 이름: Synthetic medicine');
    expect(facts[1]?.text).not.toContain('복용 완료');
    expect(facts[0]?.text).toContain('복용함');
    expect(action.text).toContain('복용·투여를 완료했어요');
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

test('batches exact protected identities without changing ordering or cutoff', async () => {
  if (dose.eventKind !== 'observed') throw new Error('fixture');
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const repository = createRecordRepository(connection.database);
    const values: LocalHealthEvidenceRecord[] = [];
    const admitted: string[] = [];
    for (let i = 103; i >= 0; i--) {
      const id = `med-${i}`;
      await repository.put('medication_definition', {
        ...medicine,
        id,
        ingestedAt: i === 5 ? '2035-01-02T00:00:00Z' : medicine.ingestedAt,
      });
      values.push({
        kind: 'dose_event',
        record: { ...dose, id: `dose-${i}`, medicationDefinitionId: id },
      });
      if (![2, 3, 4, 5].includes(i)) admitted.push(id);
    }
    await repository.put('medication_assertion', {
      id: 'med-103',
      medicationName: 'Other typed synthetic source',
      assertionKind: 'prescribed',
      effectiveAt: medicine.ingestedAt,
      recordedAt: medicine.ingestedAt,
      ingestedAt: medicine.ingestedAt,
      provenance,
      reviewState: { status: 'unreviewed' },
    });
    values.splice(1, 0, {
      kind: 'dose_event',
      record: DoseEventSchema.parse({
        id: 'asserted-dose',
        effectiveAt: dose.effectiveAt,
        ingestedAt: dose.ingestedAt,
        provenance,
        reviewState: { status: 'unreviewed' },
        eventKind: 'missed',
        recordedAt: dose.effectiveAt,
        medicationAssertionId: 'med-103',
      }),
    });
    values.push({
      kind: 'dose_event',
      record: { ...dose, id: 'second-dose', medicationDefinitionId: 'med-103' },
    });
    await connection.database.execute(
      'DELETE FROM medication_definitions WHERE id = ?',
      ['med-3'],
    );
    await connection.database.execute(
      'INSERT INTO transcript_artifact_staleness(transcript_id,artifact_kind,artifact_id,superseded_segment_id,current_segment_id,invalidated_at) VALUES (?,?,?,?,?,?)',
      [
        'synthetic',
        'medication_definition',
        'med-4',
        'old',
        'new',
        '2035-01-01',
      ],
    );
    const scope = {
      sourceIds: Array.from({ length: 104 }, (_, i) => `med-${i}`).filter(
        id => id !== 'med-2',
      ),
    };
    const cutoff = '2035-01-01T12:00:00Z';
    await connection.database.transaction(async tx => {
      const original = await Promise.all(
        values
          .slice(0, -1)
          .map(value =>
            readDailyReportMedicationContext(tx, [value], scope, cutoff),
          ),
      );
      const expected = original.flat();
      expected[0]!.doses.push('second-dose');
      let calls = 0;
      const counted: SqlExecutor = {
        execute(query, parameters) {
          calls += 1;
          return tx.execute(query, parameters);
        },
      };
      const actual = await readDailyReportMedicationContext(
        counted,
        values,
        scope,
        cutoff,
      );
      expect(actual).toEqual(expected);
      expect(
        actual.map(item => [item.value.kind, item.value.record.id]),
      ).toEqual([
        ['medication_definition', admitted[0]],
        ['medication_assertion', 'med-103'],
        ...admitted.slice(1).map(id => ['medication_definition', id]),
      ]);
      expect(calls).toBe(4);
    });
  } finally {
    connection.close();
  }
});
