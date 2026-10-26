import { createRecordRepository, runMigrations } from '@orot/storage';
import { createSymptomSummaryStorage } from '../symptomSummaryStorage';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { healthObservation } from '../../aiFeatures/integration/testSupport/personalEvidenceTestSupport';
import { hypothesis, reference } from '../../diseaseHypotheses/taskTestSupport';
import type { SavedSymptomSummary } from '../../diseaseHypotheses/savedSummaries';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  mkdtempSync,
  rmSync,
  join,
  tmpdir,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';

test('retains possibilities, contrary sources and uncertainty after closing and reopening storage', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-saved-hypotheses-'));
  const path = join(directory, 'results.sqlite');
  let connection = openSqliteTestDatabase(path);
  try {
    await runMigrations(connection.database);
    const entry = healthObservation('synthetic-hypothesis-source', []);
    await createRecordRepository(connection.database).put(
      entry.kind,
      entry.record,
    );
    const revision = fingerprint(entry.record);
    const ref = {
      ...reference,
      sourceId: entry.record.id,
      evidenceId: entry.record.id,
      sourceRevision: revision,
      evidenceRevision: revision,
      locator: { kind: 'structured_record', recordId: entry.record.id },
    };
    const value: SavedSymptomSummary = {
      id: '2035-01-01-synthetic-possibilities',
      createdAt: '2035-01-01T00:00:00Z',
      modelId: 'synthetic-model',
      modelName: 'Synthetic model',
      providerId: 'synthetic',
      analysis: {
        hypotheses: [
          hypothesis({
            supportingEvidence: [ref],
            contraryEvidence: [ref],
          }),
        ],
      },
      sources: [
        {
          reference: ref,
          records: [{ kind: entry.kind, id: entry.record.id, revision }],
        },
      ],
    };
    await createSymptomSummaryStorage(connection.database).append(value);
    connection.close();
    connection = openSqliteTestDatabase(path);
    const store = createSymptomSummaryStorage(connection.database);
    expect(await store.list()).toEqual([
      {
        id: value.id,
        createdAt: value.createdAt,
        modelName: value.modelName,
      },
    ]);
    expect(await store.read(value.id)).toEqual(value);
    expect((await store.read(value.id))?.analysis.presentation).toBeUndefined();
    await createRecordRepository(connection.database).delete(
      entry.kind,
      entry.record.id,
    );
    expect(await store.read(value.id)).toBeNull();
  } finally {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
