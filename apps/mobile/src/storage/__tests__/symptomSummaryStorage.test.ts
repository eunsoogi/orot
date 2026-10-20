import { createRecordRepository, runMigrations } from '@orot/storage';
import { HealthObservationSchema } from '@orot/domain';
import { createSymptomSummaryStorage } from '../symptomSummaryStorage';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import type { SavedSymptomSummary } from '../../diseaseHypotheses/savedSummaries';
import { reference } from '../../diseaseHypotheses/taskTestSupport';
import { decodeSavedSymptomSummary } from '../symptomSummaryStorageCodec';
import {
  applySummaryCoverageNotes,
  SUMMARY_SYMPTOM_COVERAGE_NOTE,
} from '../../diseaseHypotheses/summaryCoverageNotes';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  mkdtempSync,
  rmSync,
  join,
  tmpdir,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';

const observation = HealthObservationSchema.parse({
  id: 'synthetic-summary-measurement',
  effectiveAt: '2035-01-01T00:00:00Z',
  recordedAt: '2035-01-01T00:00:00Z',
  ingestedAt: '2035-01-01T00:00:00Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  observationKind: 'measurement',
  concept: 'heart_rate',
  value: { kind: 'quantity', amount: 72, unit: 'count/min' },
});
function saved(id = '2035-01-01-01'): SavedSymptomSummary {
  return {
    id,
    createdAt: '2035-01-01T00:00:00Z',
    modelName: 'Synthetic model',
    modelId: 'synthetic',
    providerId: 'synthetic',
    analysis: {
      presentation: 'symptom_summary',
      hypotheses: [
        {
          title: '기록 요약',
          summary: '저장된 심박수 기록이에요.',
          uncertainty: '',
          missingData: [],
          supportingEvidence: [reference],
          contraryEvidence: [],
        },
      ],
    },
    sources: [
      {
        reference,
        records: [
          {
            kind: 'health_observation',
            id: observation.id,
            revision: fingerprint(observation),
          },
        ],
      },
    ],
  };
}

test('restores up to eight summary sections and rejects an unbounded saved result', () => {
  const value = saved();
  const withCount = (count: number) => ({
    ...value,
    analysis: {
      ...value.analysis,
      hypotheses: Array.from({ length: count }, (_, index) => ({
        ...value.analysis.hypotheses[0]!,
        title: `기록 주제 ${index + 1}`,
      })),
    },
  });
  expect(decodeSavedSymptomSummary(JSON.stringify(withCount(8)))).toEqual(
    withCount(8),
  );
  expect(decodeSavedSymptomSummary(JSON.stringify(withCount(9)))).toBeNull();
});

test('persists the verified supplied-record coverage note in existing uncertainty', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    await createRecordRepository(connection.database).put(
      'health_observation',
      observation,
    );
    const base = saved('typed-coverage');
    const enriched = applySummaryCoverageNotes(
      base.analysis,
      [SUMMARY_SYMPTOM_COVERAGE_NOTE],
      [
        {
          ...reference,
          content: `health_observation: ${JSON.stringify(observation)}`,
        },
      ],
    );
    if (enriched.status !== 'valid')
      throw new Error('Expected supported coverage.');
    const store = createSymptomSummaryStorage(connection.database);
    await store.append({ ...base, analysis: enriched.value });
    const restored = await store.read(base.id);
    expect(restored?.analysis.hypotheses[0]?.uncertainty).toContain(
      '이번 요약에 제공된 기록',
    );
    expect(restored?.analysis.hypotheses[0]?.supportingEvidence).toEqual([
      reference,
    ]);
  } finally {
    connection.close();
  }
});

test('persists distinct results across database reopen and pages metadata without overwriting earlier runs', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-saved-summary-'));
  const path = join(directory, 'summaries.sqlite');
  let connection = openSqliteTestDatabase(path);
  try {
    await runMigrations(connection.database);
    await connection.database.execute('PRAGMA foreign_keys = ON');
    await createRecordRepository(connection.database).put(
      'health_observation',
      observation,
    );
    const store = createSymptomSummaryStorage(connection.database);
    for (let i = 0; i < 12; i++)
      await store.append(saved(`2035-01-01-${String(i).padStart(2, '0')}`));
    await store.append(saved('2035-01-01-00'));
    connection.close();
    connection = openSqliteTestDatabase(path);
    const restored = createSymptomSummaryStorage(connection.database);
    const first = await restored.list();
    const second = await restored.list(first[9]!.id);
    expect(first).toHaveLength(10);
    expect(second).toHaveLength(2);
    expect(first[0]).not.toHaveProperty('analysis');
    expect(await restored.read('2035-01-01-00')).toEqual(
      saved('2035-01-01-00'),
    );
    await expect(
      restored.append({
        ...saved('2035-01-01-00'),
        modelName: 'Another model',
      }),
    ).rejects.toThrow();
    expect((await restored.read('2035-01-01-00'))?.modelName).toBe(
      'Synthetic model',
    );
  } finally {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('deletes generated health text with its cited row and rejects a deletion racing the save', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    await connection.database.execute('PRAGMA foreign_keys = ON');
    const records = createRecordRepository(connection.database);
    await records.put('health_observation', observation);
    const store = createSymptomSummaryStorage(connection.database);
    await store.append(saved());
    await records.delete('health_observation', observation.id);
    expect(await store.list()).toEqual([]);
    await expect(store.append(saved('new-after-delete'))).rejects.toThrow();
    expect(await store.list()).toEqual([]);
  } finally {
    connection.close();
  }
});

test('rolls back a failed citation write and clears external-only results with all local data', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    await connection.database.execute('PRAGMA foreign_keys = ON');
    const records = createRecordRepository(connection.database);
    await records.put('health_observation', observation);
    const store = createSymptomSummaryStorage(connection.database);
    await store.list();
    await connection.database.execute(
      "CREATE TRIGGER summary_test_failure BEFORE INSERT ON symptom_summary_sources BEGIN SELECT RAISE(ABORT, 'synthetic write failure'); END",
    );
    await expect(store.append(saved())).rejects.toThrow();
    expect(await store.list()).toEqual([]);
    await connection.database.execute('DROP TRIGGER summary_test_failure');
    const external = { ...reference, sourceKind: 'external_medical' as const };
    const result = saved();
    await store.append({
      ...result,
      sources: [{ reference: external, records: [] }],
      analysis: {
        ...result.analysis,
        hypotheses: result.analysis.hypotheses.map(item => ({
          ...item,
          supportingEvidence: [external],
        })),
      },
    });
    expect(await store.list()).toHaveLength(1);
    await records.deleteAllLocalData();
    expect(await store.list()).toEqual([]);
  } finally {
    connection.close();
  }
});
