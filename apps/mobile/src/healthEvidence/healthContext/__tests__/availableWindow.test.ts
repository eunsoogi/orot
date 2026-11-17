import { createRecordRepository, runMigrations } from '@orot/storage';
import {
  healthObservation,
  medicationDefinition,
} from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { createHealthEvidenceTestDatabase } from '../../localEvidenceTestSupport';
import { createLocalEvidenceData } from '../../localEvidenceData';

const endAt = '2026-11-17T12:00:00Z';

test('resolves all available history while excluding stale, deleted, future and late-ingested rows', async () => {
  const f = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(f.database);
    const records = createRecordRepository(f.database);
    const data = createLocalEvidenceData(f.database);
    const resolve = () =>
      data.resolveHealthContextWindow!(undefined, endAt, 'UTC');
    expect(await resolve()).toBeNull();
    for (const [id, at, ingested] of [
      ['current', '2025-01-01T00:00:00Z', '2026-01-01T00:00:00Z'],
      ['late', '2024-01-01T00:00:00Z', '2026-11-18T00:00:00Z'],
      ['future', '2027-01-01T00:00:00Z', '2026-01-01T00:00:00Z'],
      ['deleted', '2023-01-01T00:00:00Z', '2026-01-01T00:00:00Z'],
      ['stale', '2022-01-01T00:00:00Z', '2026-01-01T00:00:00Z'],
    ]) {
      await records.put('health_observation', {
        ...healthObservation(id!, 'heart_rate', at!),
        recordedAt: ingested!,
        ingestedAt: ingested!,
      });
    }
    await records.delete('health_observation', 'deleted');
    await f.database.execute(
      'INSERT INTO transcript_artifact_staleness (transcript_id, artifact_kind, artifact_id, superseded_segment_id, current_segment_id, invalidated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ['transcript', 'health_observation', 'stale', 'old', 'new', endAt],
    );
    expect(await resolve()).toEqual({
      fromInclusive: '2025-01-01T00:00:00Z',
      toExclusive: endAt,
      dataAvailableThrough: endAt,
      timeZone: 'UTC',
    });
    await records.delete('health_observation', 'current');
    expect(await resolve()).toBeNull();
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      data.resolveHealthContextWindow!(aborted.signal, endAt, 'UTC'),
    ).rejects.toThrow('cancelled');
  } finally {
    f.close();
  }
});

test('uses symptom onset and ingestion-only medication registrations without inventing occurrence dates', async () => {
  const f = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(f.database);
    const records = createRecordRepository(f.database);
    const data = createLocalEvidenceData(f.database);
    await records.put(
      'medication_definition',
      medicationDefinition('medicine', '2026-01-01T00:00:00Z'),
    );
    expect(
      await data.resolveHealthContextWindow!(undefined, endAt, 'UTC'),
    ).toMatchObject({ fromInclusive: '2026-01-01T00:00:00Z' });
    await records.put('symptom_entry', {
      id: 'symptom',
      status: 'active',
      effectiveAt: '2026-10-01T00:00:00Z',
      recordedAt: '2026-10-01T00:00:00Z',
      ingestedAt: '2026-10-02T00:00:00Z',
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' },
      description: 'Synthetic historical onset',
    });
    // Imported legacy payloads may retain onset separately from effective_at.
    await f.database.execute(
      "UPDATE symptom_entries SET payload_json = json_set(payload_json, '$.startedAt', ?) WHERE id = ?",
      ['2024-01-01T00:00:00Z', 'symptom'],
    );
    expect(
      await data.resolveHealthContextWindow!(undefined, endAt, 'UTC'),
    ).toMatchObject({ fromInclusive: '2024-01-01T00:00:00Z' });
    await f.database.execute(
      'INSERT INTO legacy_symptom_deleted (id) VALUES (?)',
      ['symptom'],
    );
    expect(
      await data.resolveHealthContextWindow!(undefined, endAt, 'UTC'),
    ).toMatchObject({ fromInclusive: '2026-01-01T00:00:00Z' });
  } finally {
    f.close();
  }
});

test.each([
  ['2026-11-17T12:00:00Z', '2026-11-17T00:00:00.000Z'],
  ['2026-11-17T00:00:00Z', '2026-11-16T00:00:00.000Z'],
])(
  'includes a registration at cutoff %s without inventing dose history',
  async (cutoff, start) => {
    const f = createHealthEvidenceTestDatabase();
    try {
      await runMigrations(f.database);
      await createRecordRepository(f.database).put(
        'medication_definition',
        medicationDefinition('boundary', cutoff),
      );
      const data = createLocalEvidenceData(f.database);
      const window = await data.resolveHealthContextWindow!(
        undefined,
        cutoff,
        'UTC',
      );
      expect(window).toMatchObject({
        fromInclusive: start,
        toExclusive: cutoff,
        dataAvailableThrough: cutoff,
      });
      const report = await data.readHealthContext!(window!, ['medications']);
      expect(report.medications).toHaveLength(1);
      expect(report.medications[0]?.taken).toBe(0);
    } finally {
      f.close();
    }
  },
);
