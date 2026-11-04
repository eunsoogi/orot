import { createManualHistoryRepository, runMigrations } from '@orot/storage';
import { createSymptomSummaryStorage } from '../../../storage/symptomSummaryStorage';
import { reference } from '../../../diseaseHypotheses/taskTestSupport';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { createSummaryArtifactDiscovery } from '../summaryArtifactDiscovery';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { fingerprint } from '../evidenceUtils';
import type { AiFeatureLocalData } from '../localData';

test('discovers persisted output in pages and marks a corrected source before deletion', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-artifact-discovery-'));
  const path = join(directory, 'artifacts.sqlite');
  let connection = openSqliteTestDatabase(path);
  try {
    await runMigrations(connection.database);
    let history = createManualHistoryRepository(connection.database);
    const entry = await history.create({
      kind: 'note',
      title: 'Synthetic source',
      details: 'Synthetic details',
      effectiveDate: { status: 'unknown' },
    });
    const evidence = await history.getEvidence(entry.id);
    const store = createSymptomSummaryStorage(connection.database);
    for (const id of ['a', 'b', 'c']) {
      await store.append({
        id,
        createdAt: '2035-01-01T00:00:00Z',
        modelName: 'Synthetic',
        modelId: 'model',
        providerId: 'provider',
        analysis: {
          presentation: 'symptom_summary',
          hypotheses: [
            {
              title: 'Synthetic output',
              summary: `Retained text ${id}`,
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
                kind: 'manual_history',
                id: entry.id,
                revision: fingerprint(evidence),
              },
            ],
          },
        ],
      });
    }
    connection.close();
    connection = openSqliteTestDatabase(path);
    history = createManualHistoryRepository(connection.database);
    const discovery = createSummaryArtifactDiscovery({
      database: connection.database,
      storage: createSymptomSummaryStorage(connection.database),
      data: { manualHistory: history } as AiFeatureLocalData,
      registry: new LocalEvidenceReferenceRegistry(),
    });
    const first = await discovery.search({ query: 'Retained text', limit: 2 });
    expect(first.items.map(item => item.id)).toEqual(['c', 'b']);
    expect(first.items[0]).toMatchObject({
      type: 'symptom_summary',
      providerId: 'provider',
      modelId: 'model',
      originSession: null,
      completion: 'complete',
      review: 'unreviewed',
    });
    expect(first.nextCursor).toBe('b');
    expect(
      (
        await discovery.search({
          query: 'Retained text',
          limit: 2,
          cursor: first.nextCursor!,
        })
      ).items.map(item => item.id),
    ).toEqual(['a']);
    expect(
      (await discovery.search({ query: 'not present', limit: 2 })).items,
    ).toEqual([]);
    await connection.database.execute(
      'INSERT INTO symptom_summary_runs (id, created_at, model_name, result_json) VALUES (?, ?, ?, ?)',
      ['bb', '2035-01-01T00:00:00Z', 'Synthetic', '{invalid'],
    );
    await connection.database.execute(
      'INSERT INTO symptom_summary_runs (id, created_at, model_name, result_json) VALUES (?, ?, ?, ?)',
      [
        'bc',
        '2035-01-01T00:00:00Z',
        'Synthetic',
        '{"analysis":{"hypotheses":["bad section"]}}',
      ],
    );
    for (const query of ['', 'Retained text']) {
      const page = await discovery.search({ query, limit: 4 });
      expect(page.items.map(item => item.id)).toEqual(['c', 'b']);
      expect(page.unavailableCount).toBe(2);
      expect(page.nextCursor).toBe('b');
      expect(
        (
          await discovery.search({ query, limit: 3, cursor: page.nextCursor! })
        ).items.map(item => item.id),
      ).toEqual(['a']);
    }
    await connection.database.execute(
      'DELETE FROM symptom_summary_runs WHERE id IN (?, ?)',
      ['bb', 'bc'],
    );
    const current = await discovery.read('a');
    expect(current?.sourceStatus).toBe('current');
    expect(current?.content.hypotheses[0]?.summary).toBe('Retained text a');
    expect(current?.sources).toEqual([reference]);
    await history.correct(entry.id, {
      kind: 'note',
      title: 'Corrected source',
      details: 'Changed',
      effectiveDate: { status: 'unknown' },
    });
    expect((await discovery.read('a'))?.sourceStatus).toBe('changed');
    const racingDiscovery = createSummaryArtifactDiscovery({
      database: connection.database,
      storage: createSymptomSummaryStorage(connection.database),
      data: {
        manualHistory: {
          async getEvidence(id: string) {
            const source = await history.getEvidence(id);
            await history.delete(id);
            return source;
          },
        },
      } as unknown as AiFeatureLocalData,
      registry: new LocalEvidenceReferenceRegistry(),
    });
    expect(await racingDiscovery.read('a')).toBeNull();
    expect((await discovery.search({ query: '', limit: 2 })).items).toEqual([]);
  } finally {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
