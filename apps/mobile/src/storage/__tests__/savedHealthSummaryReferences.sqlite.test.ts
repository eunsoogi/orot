import { createRecordRepository } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../../healthEvidence/localEvidenceTestSupport';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { window } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { setup } from '../testSupport/conversationHistoryDisplayFixture';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';

test('explicitly saves only the completed original health summary identity and reopens it locally', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'saved-summary-'));
  const path = join(directory, 'synthetic.sqlite');
  const f = await setup(path);
  let originalOpen = true;
  let reopenedConnection:
    ReturnType<typeof createHealthEvidenceTestDatabase> | undefined;
  try {
    await f.summaryStorage.append(f.saved);
    await f.save('summary-turn', {
      providerId: f.saved.providerId,
      modelId: f.saved.modelId,
      healthSummary: { summaryId: f.saved.id, window },
    });
    await f.save('wrong-model-turn', {
      providerId: f.saved.providerId,
      modelId: 'wrong-model',
      healthSummary: { summaryId: f.saved.id, window },
    });
    await f.save('partial-turn', {
      status: 'partial',
      providerId: f.saved.providerId,
      modelId: f.saved.modelId,
      healthSummary: { summaryId: f.saved.id, window },
    });
    const input = {
      artifactId: 'summary-turn',
      lease: { id: 'selected', version: 0 },
      current: () => true,
    };
    expect(
      await f.storage.bookmarkHealthSummary({
        ...input,
        artifactId: 'wrong-model-turn',
      }),
    ).toBe(false);
    expect(
      await f.storage.bookmarkHealthSummary({
        ...input,
        lease: { id: 'foreign', version: 0 },
      }),
    ).toBe(false);
    expect(
      await f.storage.bookmarkHealthSummary({ ...input, current: () => false }),
    ).toBe(false);
    expect(
      await f.storage.bookmarkHealthSummary({
        ...input,
        artifactId: 'partial-turn',
      }),
    ).toBe(false);
    expect(await f.storage.bookmarkHealthSummary(input)).toBe(true);
    expect(await f.storage.bookmarkHealthSummary(input)).toBe(true);
    f.close();
    originalOpen = false;
    reopenedConnection = createHealthEvidenceTestDatabase(path);
    const database = reopenedConnection.database;
    const reopened = createConversationArtifactStorage(database);
    expect(await reopened.listSavedGeneratedReportReferences()).toEqual([
      {
        artifactId: input.artifactId,
        reportKind: 'health_summary',
        savedAt: expect.any(String),
      },
    ]);
    expect(
      await reopened.readSavedHealthSummaryReference(
        input.artifactId,
        input.current,
      ),
    ).toMatchObject({
      reference: { summaryId: f.saved.id, window },
      analysis: {
        hypotheses: [
          expect.objectContaining({
            summary: f.saved.analysis.hypotheses[0]!.summary,
          }),
        ],
      },
    });
    const { rows } = await database.execute(
      'SELECT * FROM saved_health_summary_refs',
    );
    expect(rows).toEqual([
      {
        summary_id: f.saved.id,
        artifact_id: input.artifactId,
        revision: expect.any(String),
        saved_at: expect.any(String),
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain(
      f.saved.analysis.hypotheses[0]!.summary,
    );
    await createRecordRepository(database).put('health_observation', {
      ...f.inside,
      id: 'new-synthetic-observation',
    });
    expect(
      await reopened.readSavedHealthSummaryReference(
        input.artifactId,
        input.current,
      ),
    ).toBeNull();
    await database.execute('DELETE FROM symptom_summary_runs WHERE id = ?', [
      f.saved.id,
    ]);
    expect(await reopened.listSavedGeneratedReportReferences()).toEqual([]);
  } finally {
    if (originalOpen) f.close();
    reopenedConnection?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('owner loss at the prepared SQLite commit rolls back the reference', async () => {
  const f = await setup();
  try {
    await f.summaryStorage.append(f.saved);
    await f.save('summary-turn', {
      providerId: f.saved.providerId,
      modelId: f.saved.modelId,
      healthSummary: { summaryId: f.saved.id, window },
    });
    let current = true;
    const transaction = f.db.transaction.bind(f.db);
    const observer = jest.spyOn(f.db, 'transaction').mockImplementation(work =>
      transaction(tx =>
        work({
          ...tx,
          async execute(sql, values) {
            const result = await tx.execute(sql, values);
            if (sql.includes('INSERT INTO saved_health_summary_refs'))
              current = false;
            return result;
          },
        }),
      ),
    );
    try {
      await expect(
        f.storage.bookmarkHealthSummary({
          artifactId: 'summary-turn',
          lease: { id: 'selected', version: 0 },
          current: () => current,
        }),
      ).rejects.toThrow('Summary bookmark owner moved');
      expect(await f.storage.listSavedGeneratedReportReferences()).toEqual([]);
    } finally {
      observer.mockRestore();
    }
  } finally {
    f.close();
  }
});
