import { createRecordRepository, runMigrations } from '@orot/storage';
import {
  healthObservation,
  medicationDefinition,
  importedDoseEvent,
} from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { createHealthEvidenceTestDatabase } from '../../localEvidenceTestSupport';
import { createHealthContextReader } from '../reader';

test('bounds every source query by the generation-time ingestion cutoff', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  const cutoff = '2026-10-01T12:00:00.000Z';
  const snapshotWindow = {
    fromInclusive: '2026-10-01T00:00:00.000Z',
    toExclusive: cutoff,
    timeZone: 'UTC',
    dataAvailableThrough: cutoff,
    doseHistory: { page: 0, pageSize: 20 },
  };
  try {
    await runMigrations(database);
    const records = createRecordRepository(database);
    for (const [id, effectiveAt, ingestedAt, amount] of [
      ['quantity-included', '2026-10-01T10:00:00Z', cutoff, 72],
      [
        'quantity-late',
        '2026-10-01T09:00:00Z',
        '2026-10-01T12:00:00.001Z',
        120,
      ],
    ] as const) {
      const observation = healthObservation(id, 'heart_rate', effectiveAt);
      await records.put('health_observation', {
        ...observation,
        ingestedAt,
        value: { kind: 'quantity', amount, unit: 'count/min' },
      });
    }
    for (const [id, startedAt, endedAt, ingestedAt] of [
      [
        'sleep-included',
        '2026-10-01T10:00:00Z',
        '2026-10-01T11:00:00Z',
        cutoff,
      ],
      [
        'sleep-late',
        '2026-10-01T09:00:00Z',
        '2026-10-01T09:30:00Z',
        '2026-10-01T12:00:00.001Z',
      ],
    ] as const) {
      await records.put('health_observation', {
        ...healthObservation(
          id,
          'HKCategoryTypeIdentifierSleepAnalysis',
          startedAt,
          'healthkit',
          'imported',
          endedAt,
        ),
        ingestedAt,
        value: { kind: 'text', text: '3' },
      });
    }
    for (const [id, effectiveAt, ingestedAt, description] of [
      ['symptom-included', '2026-10-01T11:00:00Z', cutoff, 'Before cutoff'],
      [
        'symptom-late',
        '2026-10-01T09:00:00Z',
        '2026-10-01T12:00:00.001Z',
        'After cutoff',
      ],
    ] as const) {
      await records.put('symptom_entry', {
        status: 'active',
        id,
        effectiveAt,
        recordedAt: effectiveAt,
        ingestedAt,
        provenance: { origin: 'user_reported', sourceRecordIds: [] },
        reviewState: { status: 'unreviewed' },
        description,
        severity: 3,
      });
    }
    for (const [id, ingestedAt, displayText] of [
      ['medication-included', cutoff, 'Before cutoff medicine'],
      ['medication-late', '2026-10-01T12:00:00.001Z', 'After cutoff medicine'],
    ] as const) {
      await records.put('medication_definition', {
        ...medicationDefinition(id, ingestedAt),
        displayText,
      });
    }
    for (const [id, ingestedAt, medicationName] of [
      ['assertion-included', cutoff, 'Before cutoff prescription'],
      [
        'assertion-late',
        '2026-10-01T12:00:00.001Z',
        'After cutoff prescription',
      ],
    ] as const) {
      await records.put('medication_assertion', {
        id,
        effectiveAt: '2026-10-01T08:00:00Z',
        recordedAt: '2026-10-01T08:00:00Z',
        ingestedAt,
        provenance: { origin: 'user_reported', sourceRecordIds: [] },
        reviewState: { status: 'unreviewed' },
        medicationName,
        assertionKind: 'prescribed',
      });
    }
    for (const [id, effectiveAt, ingestedAt] of [
      ['dose-included', '2026-10-01T10:00:00Z', cutoff],
      ['dose-late', '2026-10-01T09:00:00Z', '2026-10-01T12:00:00.001Z'],
    ] as const) {
      await records.put('dose_event', {
        ...importedDoseEvent(id, effectiveAt, 'taken'),
        medicationDefinitionId: 'medication-included',
        ingestedAt,
      });
    }
    for (const [id, effectiveAt, ingestedAt] of [
      ['asserted-dose-included', '2026-10-01T10:30:00Z', cutoff],
      [
        'asserted-dose-late',
        '2026-10-01T09:30:00Z',
        '2026-10-01T12:00:00.001Z',
      ],
    ] as const) {
      await records.put('dose_event', {
        id,
        effectiveAt,
        recordedAt: effectiveAt,
        ingestedAt,
        provenance: { origin: 'user_reported', sourceRecordIds: [] },
        reviewState: { status: 'unreviewed' },
        eventKind: 'missed',
        medicationAssertionId: 'assertion-included',
      });
    }

    const report = await createHealthContextReader(database)(snapshotWindow, [
      'measurements',
      'medications',
      'sleep',
      'symptoms',
    ]);

    expect(report.quantities[0]?.days).toMatchObject([
      { samples: 1, latest: 72, sum: 72 },
    ]);
    expect(report.sleep).toMatchObject([
      { asleepSeconds: 3600, sampleCount: 1 },
    ]);
    expect(report.symptoms).toMatchObject({
      entryCount: 1,
      latest: [{ description: 'Before cutoff' }],
    });
    expect(report.medications.map(medication => medication.name)).toEqual([
      'Before cutoff medicine',
      'Before cutoff prescription',
    ]);
    expect(report.medications.map(medication => medication.taken)).toEqual([
      1, 0,
    ]);
    expect(report.medications.map(medication => medication.skipped)).toEqual([
      0, 1,
    ]);
    expect(report.doseHistory?.records).toHaveLength(2);
    expect(
      report.doseHistory?.records.map(record => record.effectiveAt),
    ).toEqual(['2026-10-01T10:00:00Z', '2026-10-01T10:30:00Z']);
  } finally {
    close();
  }
});
