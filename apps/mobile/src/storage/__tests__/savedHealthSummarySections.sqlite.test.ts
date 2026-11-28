import { MAX_SYMPTOM_SUMMARY_SECTIONS } from '../../diseaseHypotheses/types';
import { decodeSavedSymptomSummary } from '../symptomSummaryStorageCodec';
import { createRecordRepository } from '@orot/storage';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { window } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createHealthEvidenceTestDatabase } from '../../healthEvidence/localEvidenceTestSupport';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { setup } from '../testSupport/conversationHistoryDisplayFixture';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';

test('retains only the selected generated section and invalidates the exact original after cold read', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'summary-sections-'));
  const path = join(dir, 'fixture.sqlite');
  const f = await setup(path);
  let close = f.close;
  let positive = true;
  const current = () => positive;
  const confirmProtected = jest.fn(async () => positive);
  const proof = { current, confirmProtected };
  try {
    const original = f.saved.analysis.hypotheses[0]!;
    const other = {
      ...original,
      uncertainty: 'Synthetic qualifier',
      missingData: ['Synthetic missing context'],
      title: 'Synthetic second section',
      summary: 'Synthetic second text',
    };
    const saved = {
      ...f.saved,
      analysis: { ...f.saved.analysis, hypotheses: [original, other] },
    };
    await f.summaryStorage.append(saved);
    await f.save('fixture-summary', {
      providerId: saved.providerId,
      modelId: saved.modelId,
      healthSummary: { summaryId: saved.id, window },
    });
    const storage = createConversationArtifactStorage(f.db, db => db === f.db);
    const owner = {
      ...proof,
      artifactId: 'fixture-summary',
      lease: { id: 'selected', version: 0 },
      revision: fingerprint(saved),
    };
    expect(await storage.readExactHealthSummarySections(owner)).toEqual([
      {
        ordinal: 0,
        title: original.title,
        summary: original.summary,
        uncertainty: original.uncertainty,
        missingData: original.missingData,
      },
      {
        ordinal: 1,
        title: other.title,
        summary: other.summary,
        uncertainty: other.uncertainty,
        missingData: other.missingData,
      },
    ]);
    for (const rejected of [
      { ...owner, lease: { id: 'foreign', version: 0 } },
      { ...owner, revision: 'wrong' },
      { ...owner, confirmProtected: async () => false },
    ])
      expect(
        await storage.bookmarkHealthSummarySection(rejected, 1, 'nope'),
      ).toBeUndefined();

    const checks = jest
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    await expect(
      storage.bookmarkHealthSummarySection(
        { ...owner, confirmProtected: checks },
        1,
        'revoked',
      ),
    ).rejects.toThrow('no longer available');
    expect(await storage.listSavedGeneratedReportReferences()).toEqual([]);
    expect(
      await storage.bookmarkHealthSummarySection(owner, 1, 'section'),
    ).toBe('section');
    expect(
      await storage.bookmarkHealthSummarySection(owner, 1, 'duplicate'),
    ).toBe('section');
    const { rows } = await f.db.execute(
      'SELECT * FROM saved_health_summary_sections',
    );
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toMatch(/Synthetic second (text|section)/);
    close();
    const next = createHealthEvidenceTestDatabase(path);
    close = next.close;
    const database = next.database;
    const reopened = createConversationArtifactStorage(
      database,
      db => db === database,
    );
    expect(await reopened.listSavedGeneratedReportReferences()).toMatchObject([
      { artifactId: 'section', reportKind: 'health_summary_section' },
    ]);
    expect(
      await reopened.readBookmarkedHealthSummarySection('section', proof),
    ).toMatchObject({
      ordinal: 1,
      title: other.title,
      summary: other.summary,
      uncertainty: other.uncertainty,
      missingData: other.missingData,
      detail: {
        analysis: {
          hypotheses: [
            {
              summary: other.summary,
              uncertainty: other.uncertainty,
              missingData: other.missingData,
            },
          ],
        },
      },
    });
    positive = false;
    expect(
      await reopened.readBookmarkedHealthSummarySection('section', proof),
    ).toBeNull();
    positive = true;
    await createRecordRepository(database).put('health_observation', {
      ...f.inside,
      id: 'new-synthetic-observation',
    });
    expect(
      await reopened.readBookmarkedHealthSummarySection('section', proof),
    ).toBeNull();
    await reopened.deleteSession('selected');
    expect(await reopened.listSavedGeneratedReportReferences()).toEqual([]);
  } finally {
    close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('stock archive rejects over-limit Health Summary rows, without presenting the first eight as eligible', async () => {
  const f = await setup();
  try {
    const section = f.saved.analysis.hypotheses[0]!;
    const raw = (size: number) => ({
      ...f.saved,
      analysis: {
        ...f.saved.analysis,
        hypotheses: Array.from({ length: size }, (_, i) => ({
          ...section,
          title: 'Synthetic ' + i,
        })),
      },
    });
    expect(
      decodeSavedSymptomSummary(
        JSON.stringify(raw(MAX_SYMPTOM_SUMMARY_SECTIONS)),
      )?.analysis.hypotheses,
    ).toHaveLength(MAX_SYMPTOM_SUMMARY_SECTIONS);
    expect(
      decodeSavedSymptomSummary(
        JSON.stringify(raw(MAX_SYMPTOM_SUMMARY_SECTIONS + 1)),
      ),
    ).toBeNull();
  } finally {
    f.close();
  }
});
