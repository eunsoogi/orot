import { runMigrations } from '@orot/storage';
import { createSymptomSummaryStorage } from '../../../storage/symptomSummaryStorage';
import { reference } from '../../../diseaseHypotheses/taskTestSupport';
import { referenceOnly } from '../../../diseaseHypotheses/resultValidation';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  mkdtempSync,
  rmSync,
  join,
  tmpdir,
} from '../../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { annotatePublicSearchLimit } from '../defaultPublicSearch';
import { createSymptomSummaryPersistence } from '../symptomSummaryPersistence';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';

test.each([490, 500])(
  'preserves a %i-character uncertainty through failed save, retry and database reopen',
  async length => {
    const directory = mkdtempSync(join(tmpdir(), 'public-search-summary-'));
    const path = join(directory, 'summary.sqlite');
    let connection = openSqliteTestDatabase(path);
    try {
      await runMigrations(connection.database);
      const store = createSymptomSummaryStorage(connection.database);
      await store.list();
      const registry = new LocalEvidenceReferenceRegistry();
      const alias = referenceOnly(
        registry.add({
          reference,
          content: 'synthetic record',
          validate: async () => true,
          readSource: async () => ({
            status: 'available',
            document: { sourceKind: 'personal_record', records: [] },
          }),
        }),
      );
      const persistence = createSymptomSummaryPersistence({
        registry,
        data: async () => localData([]).data,
        storage: async () => store,
      });
      const original = '가'.repeat(length);
      const result = annotatePublicSearchLimit(
        {
          status: 'workflow',
          result: {
            status: 'result',
            value: {
              hypotheses: [
                {
                  title: '기록',
                  summary: '저장된 기록이에요.',
                  uncertainty: original,
                  supportingEvidence: [alias],
                  contraryEvidence: [],
                  missingData: [],
                },
              ],
            },
            citations: [alias],
            coverage: [],
            checkpoint: {} as never,
          },
        },
        { status: 'unavailable' },
      );
      if (result.status !== 'workflow' || result.result.status !== 'result')
        throw new Error('Expected result');
      await connection.database.execute(
        "CREATE TRIGGER test_search_failure BEFORE INSERT ON symptom_summary_runs BEGIN SELECT RAISE(ABORT, 'synthetic write failure'); END",
      );
      const first = await persistence.save(
        result,
        publicEvidenceFixture().selected,
        'search-limit',
        new AbortController().signal,
        '2035-01-01T00:00:00.000Z',
      );
      if (first.status !== 'workflow' || first.result.status !== 'result')
        throw new Error('Expected result');
      expect(first.result.value.savedSummary).toEqual({ status: 'failed' });
      await connection.database.execute('DROP TRIGGER test_search_failure');
      const retried = await persistence.history.retrySave!();
      expect(retried?.savedSummary?.status).toBe('saved');
      connection.close();
      connection = openSqliteTestDatabase(path);
      const restored = await createSymptomSummaryStorage(
        connection.database,
      ).read('2035-01-01T00:00:00.000Z-search-limit');
      expect(restored?.analysis.hypotheses[0]?.uncertainty).toBe(original);
      expect(restored?.analysis.hypotheses[0]?.missingData).toContain(
        '공개 웹검색을 사용할 수 없어 검색 결과를 반영하지 못했어요.',
      );
    } finally {
      connection.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
