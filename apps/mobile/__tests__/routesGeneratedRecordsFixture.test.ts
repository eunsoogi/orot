import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  seedRoutesGeneratedRecords,
  routesGeneratedRecords as ids,
} from '../e2e/routesGeneratedRecordsFixture';
import { createGeneratedReportReader } from '../src/generatedReports/readers';
import { createLocalEvidenceData } from '../src/healthEvidence/localEvidenceData';
import { createLocalHealthEvidenceRepository } from '../src/healthEvidence/localEvidenceRepository';
import { createSymptomSummaryStorage } from '../src/storage/symptomSummaryStorage';
import { createSummaryArtifactDiscovery } from '../src/aiFeatures/integration/summaryArtifactDiscovery';
import type { AiFeatureLocalData } from '../src/aiFeatures/integration/localData';

test('real writers retain four readable generated outputs and a source-backed appointment question; deletion stays strict', async () => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(f.database);
    const records = createRecordRepository(f.database);
    await seedRoutesGeneratedRecords(f.database, records);
    const data: AiFeatureLocalData = {
      ...createLocalEvidenceData(f.database),
      repository: createLocalHealthEvidenceRepository(f.database),
      rag: {
        index: async () => {
          throw new Error('No inference');
        },
        search: async () => {
          throw new Error('No inference');
        },
      },
      memoryStorage: { listRecords: async () => [] },
      loadMemoryRecords: async () => [],
    };
    data.summaryArtifactDiscovery = async registry =>
      createSummaryArtifactDiscovery({
        database: f.database,
        storage: createSymptomSummaryStorage(f.database),
        registry,
        data,
      });
    const reader = createGeneratedReportReader(f.database, {
      data: async () => data,
      records: async () => records,
    });
    const rows = await reader.list();
    expect(rows.map(row => row.kind).sort()).toEqual([
      'daily_report',
      'health_summary',
      'possibilities',
      'visit_questions',
    ]);
    for (const [kind, text] of [
      ['possibilities', ids.possibilitiesText],
      ['health_summary', ids.summaryText],
      ['daily_report', ids.dailyText],
      ['visit_questions', ids.questionText],
    ]) {
      const row = rows.find(item => item.kind === kind)!;
      const detail = await reader.read(row, new AbortController().signal);
      expect(detail?.paragraphs.join('\n')).toContain(text);
    }
    expect((await records.list('appointment'))[0]?.id).toBe(ids.appointmentId);
    expect((await records.list('visit_question'))[0]?.appointmentId).toBe(
      ids.appointmentId,
    );
    await expect(
      seedRoutesGeneratedRecords(f.database, records),
    ).rejects.toThrow('empty record stores');
    expect(await reader.list()).toEqual(rows);
    await records.delete('health_observation', ids.sourceId);
    for (const row of rows) {
      await expect(
        reader.read(row, new AbortController().signal),
      ).resolves.toBeNull();
    }
  } finally {
    f.close();
  }
});
