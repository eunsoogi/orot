import { createLocalRecordQueryRepository, runMigrations } from '../src';
import { createRecordRepository } from '../src/repository';
import type { SqlDatabase } from '../src';
import { createDatabase } from './sourceEvidenceTestSupport';
import {
  appointment,
  audioSource,
  healthObservation,
  importedDoseEvent,
  medicationDefinition,
  transcriptSegment,
} from './localQueryTestSupport';

describe('bounded local query timestamp precision', () => {
  let database: SqlDatabase;
  let repository: ReturnType<typeof createRecordRepository>;
  let queries: ReturnType<typeof createLocalRecordQueryRepository>;

  beforeEach(async () => {
    database = createDatabase();
    await runMigrations(database);
    repository = createRecordRepository(database);
    queries = createLocalRecordQueryRepository(database);
  });

  afterEach(async () => database.closeAsync?.());

  it('keeps nanosecond half-open bounds exact for HealthKit observations', async () => {
    const range = {
      fromInclusive: '2026-10-01T06:00:00.123400000Z',
      toExclusive: '2026-10-01T06:00:01.123400000Z',
    };
    // These source instants differ by 100 ns around a bound that SQLite day floats cannot retain.
    await repository.put(
      'health_observation',
      healthObservation('before-start', 'heart_rate', '2026-10-01T06:00:00.123300000Z'),
    );
    await repository.put(
      'health_observation',
      healthObservation('control-inside', 'heart_rate', '2026-10-01T06:00:00.500000000Z'),
    );
    await repository.put(
      'health_observation',
      healthObservation('inside-before-end', 'heart_rate', '2026-10-01T06:00:01.123300000Z'),
    );

    const result = await queries.queryHealthObservations({ ...range, type: 'heart_rate' });

    expect(result.records.map((record) => record.id)).toEqual([
      'control-inside',
      'inside-before-end',
    ]);
  });

  it('orders nanosecond instants before applying the row limit', async () => {
    const range = {
      fromInclusive: '2026-10-01T06:00:00.123400000Z',
      toExclusive: '2026-10-01T06:00:00.123402000Z',
    };
    await repository.put(
      'health_observation',
      healthObservation('z-earlier', 'heart_rate', '2026-10-01T06:00:00.123400500Z'),
    );
    await repository.put(
      'health_observation',
      healthObservation('a-later', 'heart_rate', '2026-10-01T06:00:00.123401000Z'),
    );

    const result = await queries.queryHealthObservations({
      ...range,
      type: 'heart_rate',
      limit: 1,
    });

    expect(result.records.map((record) => record.id)).toEqual(['z-earlier']);
    expect(result.hasMore).toBe(true);
  });

  it('applies exact bounds to medication, dose, appointment and transcript timestamps', async () => {
    const range = {
      fromInclusive: '2026-10-01T06:00:00.123400000Z',
      toExclusive: '2026-10-01T06:00:00.123401000Z',
    };
    await repository.put(
      'medication_definition',
      medicationDefinition('med-before', '2026-10-01T06:00:00.123399999Z'),
    );
    await repository.put(
      'medication_definition',
      medicationDefinition('med-inside', '2026-10-01T06:00:00.123400999Z'),
    );
    await repository.put(
      'dose_event',
      importedDoseEvent('dose-before', '2026-10-01T06:00:00.123399999Z', 'taken'),
    );
    await repository.put(
      'dose_event',
      importedDoseEvent('dose-inside', '2026-10-01T06:00:00.123400999Z', 'taken'),
    );
    await repository.put(
      'appointment',
      appointment('appointment-before', '2026-10-01T06:00:00.123399999Z', 'scheduled', true),
    );
    await repository.put(
      'appointment',
      appointment('appointment-at-start', range.fromInclusive, 'scheduled', true),
    );

    const recording = audioSource('audio-precision');
    await repository.sourceRecords.create(recording);
    const segmentAt = (ordinal: number, effectiveAt: string) => {
      const transcriptId = `${recording.id}:segment:${ordinal}`;
      return {
        ...transcriptSegment(recording.id, `Synthetic segment ${ordinal}`),
        id: `${transcriptId}:r1`,
        transcriptId,
        segmentOrdinal: ordinal,
        effectiveAt,
        recordedAt: effectiveAt,
        ingestedAt: effectiveAt,
      };
    };
    await repository.transcripts.append([
      segmentAt(0, '2026-10-01T06:00:00.123399999Z'),
      segmentAt(1, '2026-10-01T06:00:00.123400999Z'),
    ]);

    const medications = await queries.queryImportedMedicationDefinitions(range);
    const doses = await queries.queryImportedDoseEvents(range);
    const appointmentResult = await queries.queryNextConfirmedCalendarAppointment(
      range.fromInclusive,
    );
    const transcripts = await queries.queryTranscriptEvidence({
      ...range,
      recordingSourceId: recording.id,
    });

    expect(medications.records.map((record) => record.id)).toEqual(['med-inside']);
    expect(doses.records.map((record) => record.id)).toEqual(['dose-inside']);
    expect(appointmentResult.appointment?.id).toBe('appointment-at-start');
    expect(transcripts.records.map((record) => record.id)).toEqual([
      `${recording.id}:segment:1:r1`,
    ]);
  });

  it('distinguishes interval ends at the inclusive start from ends one nanosecond later', async () => {
    const range = {
      fromInclusive: '2026-10-01T06:00:00.123400000Z',
      toExclusive: '2026-10-01T06:30:00.123400000Z',
    };
    await repository.put(
      'health_observation',
      healthObservation(
        'sleep-ends-at-start',
        'HKCategoryTypeIdentifierSleepAnalysis',
        '2026-10-01T05:30:00Z',
        'healthkit',
        'imported',
        range.fromInclusive,
      ),
    );
    await repository.put(
      'health_observation',
      healthObservation(
        'sleep-crosses-start',
        'HKCategoryTypeIdentifierSleepAnalysis',
        '2026-10-01T05:30:00Z',
        'healthkit',
        'imported',
        '2026-10-01T06:00:00.123400001Z',
      ),
    );

    const result = await queries.queryHealthObservations({ ...range, type: 'sleep' });

    expect(result.records.map((record) => record.id)).toEqual(['sleep-crosses-start']);
  });

  it('enforces the maximum range at submillisecond precision', async () => {
    const fromInclusive = '2025-10-01T00:00:00.123400000Z';
    const exactMaximum = '2026-10-02T00:00:00.123400000Z';

    await expect(
      queries.queryHealthObservations({
        fromInclusive,
        toExclusive: exactMaximum,
        type: 'heart_rate',
      }),
    ).resolves.toMatchObject({ status: 'no_local_records_in_range' });
    await expect(
      queries.queryHealthObservations({
        fromInclusive,
        toExclusive: '2026-10-02T00:00:00.123400001Z',
        type: 'heart_rate',
      }),
    ).rejects.toThrow('cannot exceed 366 days');
  });
});
