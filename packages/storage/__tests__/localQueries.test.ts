import { createLocalRecordQueryRepository, runMigrations } from '../src';
import type { SqlDatabase } from '../src';
import { createRecordRepository } from '../src/repository';
import { createDatabase } from './sourceEvidenceTestSupport';
import {
  appointment,
  healthObservation,
  importedDoseEvent,
  medicationDefinition,
} from './localQueryTestSupport';

const range = {
  fromInclusive: '2026-10-01T06:00:00.000Z',
  toExclusive: '2026-10-01T07:00:00.000Z',
};

describe('bounded local record queries', () => {
  let database: SqlDatabase;
  let repository: ReturnType<typeof createRecordRepository>;
  let queries: ReturnType<typeof createLocalRecordQueryRepository>;
  let statements: Array<{ query: string; parameters: unknown[] }>;

  beforeEach(async () => {
    database = createDatabase();
    await runMigrations(database);
    repository = createRecordRepository(database);
    statements = [];
    const trackedDatabase: SqlDatabase = {
      execute: (query, parameters = []) => {
        statements.push({ query, parameters });
        return database.execute(query, parameters);
      },
      transaction: (operation) => database.transaction(operation),
    };
    queries = createLocalRecordQueryRepository(trackedDatabase);
  });

  afterEach(async () => database.closeAsync?.());

  it('binds type, date and row bounds while preserving source values and stable order', async () => {
    await repository.put(
      'health_observation',
      healthObservation('bp-a', 'blood pressure systolic', '2026-10-01T08:00:00.000+02:00'),
    );
    await repository.put(
      'health_observation',
      healthObservation('bp-b', 'blood pressure diastolic', '2026-10-01T06:00:00.000Z'),
    );
    await repository.put(
      'health_observation',
      healthObservation('bp-c', 'blood pressure systolic', '2026-10-01T06:30:00.000Z'),
    );
    await repository.put(
      'health_observation',
      healthObservation('bp-at-end', 'blood pressure systolic', range.toExclusive),
    );
    await repository.put(
      'health_observation',
      healthObservation(
        'manual-bp',
        'blood pressure systolic',
        '2026-10-01T06:10:00Z',
        'healthkit',
        'user_reported',
      ),
    );
    await repository.put(
      'health_observation',
      healthObservation(
        'other-source-bp',
        'blood pressure systolic',
        '2026-10-01T06:11:00Z',
        'other-device',
      ),
    );

    const result = await queries.queryHealthObservations({
      ...range,
      type: 'blood_pressure',
      limit: 2,
    });

    expect(result).toMatchObject({ status: 'available', limit: 2, hasMore: true });
    expect(result.records.map((record) => record.id)).toEqual(['bp-a', 'bp-b']);
    expect(result.records[0]).toMatchObject({
      effectiveAt: '2026-10-01T08:00:00.000+02:00',
      value: { kind: 'quantity', amount: 120, unit: 'mmHg' },
      provenance: { sourceRecordIds: ['source-healthkit'], source: { system: 'healthkit' } },
    });
    expect(statements[0]?.query).toContain('concept');
    expect(statements[0]?.query).toContain('LIMIT ?');
    expect(statements[0]?.parameters).toEqual([
      'blood pressure systolic',
      'blood pressure diastolic',
      '101790838000.!',
      '101790834400.!',
      '101790834400.!',
      '101790838000.!',
      3,
    ]);
  });

  it('includes overlapping sleep intervals and reports HealthKit medication timestamps faithfully', async () => {
    await repository.put(
      'health_observation',
      healthObservation(
        'sleep-overlap',
        'HKCategoryTypeIdentifierSleepAnalysis',
        '2026-10-01T05:30:00Z',
        'healthkit',
        'imported',
        '2026-10-01T06:30:00Z',
      ),
    );
    await repository.put(
      'medication_definition',
      medicationDefinition('med-1', range.fromInclusive),
    );
    await repository.put(
      'medication_definition',
      medicationDefinition('med-outside', range.toExclusive),
    );

    const sleep = await queries.queryHealthObservations({ ...range, type: 'sleep' });
    const medications = await queries.queryImportedMedicationDefinitions(range);

    expect(sleep.records[0]).toMatchObject({
      id: 'sleep-overlap',
      endedAt: '2026-10-01T06:30:00Z',
    });
    expect(medications).toMatchObject({ status: 'available', timeBasis: 'local_ingest' });
    expect(medications.records.map((record) => record.id)).toEqual(['med-1']);
    expect(medications.records[0]?.effectiveAt).toBeUndefined();
    expect(medications.records[0]?.ingestedAt).toBe(range.fromInclusive);
  });

  it('keeps imported dose statuses and excludes user-entered events', async () => {
    await repository.put(
      'dose_event',
      importedDoseEvent('dose-1', range.fromInclusive, 'not_logged'),
    );
    await repository.put(
      'dose_event',
      importedDoseEvent('dose-2', '2026-10-01T06:20:00Z', 'taken'),
    );
    await repository.put('dose_event', {
      id: 'manual-dose',
      effectiveAt: '2026-10-01T06:10:00Z',
      recordedAt: '2026-10-01T06:10:00Z',
      ingestedAt: '2026-10-01T06:10:00Z',
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' },
      eventKind: 'taken',
      medicationAssertionId: 'assertion-1',
    });

    const result = await queries.queryImportedDoseEvents({ ...range, limit: 1 });

    expect(result).toMatchObject({ status: 'available', hasMore: true, limit: 1 });
    expect(result.records).toMatchObject([
      { id: 'dose-1', eventKind: 'observed', observationStatus: 'not_logged' },
    ]);
  });

  it('returns only the next confirmed, upcoming Calendar event', async () => {
    await repository.put(
      'appointment',
      appointment('manual', '2026-10-01T09:10:00Z', 'scheduled', false),
    );
    await repository.put(
      'appointment',
      appointment('cancelled', '2026-10-01T09:20:00Z', 'cancelled', true),
    );
    await repository.put(
      'appointment',
      appointment('next', '2026-10-01T09:30:00Z', 'scheduled', true),
    );

    await expect(
      queries.queryNextConfirmedCalendarAppointment('2026-10-01T09:00:00Z'),
    ).resolves.toMatchObject({
      status: 'available',
      appointment: { id: 'next', calendarEventIdentifier: 'calendar-event-next' },
    });
    await expect(
      queries.queryNextConfirmedCalendarAppointment('2026-10-01T10:00:00Z'),
    ).resolves.toEqual({
      status: 'no_confirmed_upcoming_calendar_appointment',
      appointment: null,
    });
  });

  it('rejects invalid and oversized query bounds instead of widening a local read', async () => {
    await expect(
      queries.queryHealthObservations({ ...range, type: 'steps', limit: 101 }),
    ).rejects.toThrow('limit must be between 1 and 100');
    await expect(
      queries.queryHealthObservations({
        fromInclusive: '2025-01-01T00:00:00Z',
        toExclusive: '2026-10-01T00:00:00Z',
        type: 'steps',
      }),
    ).rejects.toThrow('cannot exceed 366 days');
    await expect(
      queries.queryHealthObservations({ ...range, type: 'unknown' as never }),
    ).rejects.toThrow('not supported');
  });
});
