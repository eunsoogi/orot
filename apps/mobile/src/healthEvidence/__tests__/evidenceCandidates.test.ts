import { createRecordRepository, runMigrations } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../localEvidenceTestSupport';
import {
  findEvidenceIdentifiers,
  readEvidenceCandidates,
} from '../evidenceCandidates';
import { readCurrentEvidenceChunks } from '../currentEvidenceChunks';

const at = '2026-10-18T00:00:00.000Z';
const metadata = {
  effectiveAt: at,
  ingestedAt: at,
  recordedAt: at,
  provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' as const },
};

test('keeps full catalog counts separate from diversified candidate payloads', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const repository = createRecordRepository(database);
    for (let index = 0; index < 110; index += 1) {
      await repository.put('health_observation', {
        ...metadata,
        id: `heart-${index}`,
        observationKind: 'measurement',
        concept: 'heart_rate',
        value: { kind: 'quantity', amount: 70, unit: 'count/min' },
      });
    }
    await repository.put('health_observation', {
      ...metadata,
      id: 'older-pressure',
      effectiveAt: '2020-01-01T00:00:00.000Z',
      observationKind: 'measurement',
      concept: 'blood pressure systolic',
      value: { kind: 'quantity', amount: 120, unit: 'mmHg' },
    });
    await repository.put('medication_definition', {
      ...metadata,
      id: 'rare-medication',
      displayText: 'Synthetic medication',
      medicationConceptIdentifier: 'synthetic',
      generalForm: 'tablet',
      isArchived: false,
      hasSchedule: true,
    });
    const selected = await readEvidenceCandidates(database, '건강 기록');
    expect(selected.catalog.totalRecordCount).toBe(112);
    expect(selected.catalog.inventoryComplete).toBe(true);
    expect(selected.catalog.truncatedKinds).toEqual([]);
    expect(selected.hasMoreCandidates).toBe(true);
    expect(selected.candidates).toHaveLength(17);
    expect(selected.candidates.map(entry => entry.record.id)).toEqual(
      expect.arrayContaining(['older-pressure', 'rare-medication']),
    );
    const filtered = await readEvidenceCandidates(database, '혈압', undefined, {
      timeRange: {
        fromInclusive: '2019-12-31T15:00:00-09:00',
        toExclusive: '2020-01-02T00:00:00Z',
      },
    });
    expect(filtered.candidates.map(entry => entry.record.id)).toEqual([
      'older-pressure',
    ]);
  } finally {
    close();
  }
});

test('finds an identifier embedded in selected text even when its record is outside candidates', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const repository = createRecordRepository(database);
    await repository.put('symptom_entry', {
      status: 'active',
      ...metadata,
      id: 'outside record / 42',
      description: 'Synthetic note',
    });
    expect(
      await findEvidenceIdentifiers(
        database,
        'The note refers to outside record / 42.',
      ),
    ).toEqual(['outside record / 42']);
    expect(
      await findEvidenceIdentifiers(database, 'No linked identifier here.'),
    ).toEqual([]);
  } finally {
    close();
  }
});

test('rebuilds exact citations and rejects modified, removed, and stale source rows', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const repository = createRecordRepository(database);
    const record = {
      status: 'active' as const,
      ...metadata,
      id: 'selected-symptom',
      description: 'Original synthetic note',
    };
    await repository.put('symptom_entry', record);
    const ids = [{ kind: 'symptom_entry' as const, id: record.id }];
    const before = await readCurrentEvidenceChunks(database, ids);
    await repository.put('symptom_entry', {
      ...record,
      description: 'Changed synthetic note',
    });
    const after = await readCurrentEvidenceChunks(database, ids);
    expect(after[0]?.text).not.toBe(before[0]?.text);
    await database.execute(
      'INSERT INTO transcript_artifact_staleness (transcript_id, artifact_kind, artifact_id, superseded_segment_id, current_segment_id, invalidated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ['transcript', 'symptom_entry', record.id, 'old', 'new', at],
    );
    expect(await readCurrentEvidenceChunks(database, ids)).toEqual([]);
    await repository.delete('symptom_entry', record.id);
    expect(await readCurrentEvidenceChunks(database, ids)).toEqual([]);
  } finally {
    close();
  }
});

test('large identifier tables preserve exact substring matching for arbitrary IDs', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    await database.execute(
      `INSERT INTO symptom_entries (id, effective_at, recorded_at, ingested_at, payload_json)
      WITH RECURSIVE n(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM n WHERE value < 5000)
      SELECT 'unrelated-' || value, ?, ?, ?, '{}' FROM n`,
      [at, at, at],
    );
    const special = [
      'outside record / 42',
      '기록/가',
      'record',
      'x',
      '기록😀끝',
      'e\u0301/기록',
    ];
    for (const id of special) {
      await database.execute(
        'INSERT INTO symptom_entries (id, effective_at, recorded_at, ingested_at, payload_json) VALUES (?, ?, ?, ?, ?)',
        [id, at, at, at, '{}'],
      );
    }
    expect(
      [
        ...(await findEvidenceIdentifiers(
          database,
          '합성 긴 전사 문장 '.repeat(200) +
            'prefix: outside record / 42; 기록/가; outside record / 42; 기록😀끝; e\u0301/기록.',
        )),
      ].sort(),
    ).toEqual([...special].sort());
    expect(await findEvidenceIdentifiers(database, 'none here')).toEqual([]);
  } finally {
    close();
  }
});
