import { assertGeneratedVisitQuestionSource } from '../../agent/visitQuestions/generatedVisitQuestionValidation';
import { revalidateSummaryArtifacts } from '../summaryArtifactRevalidation';
import { assertConversationSummaryParent } from '../conversationSummaryParent';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { isPeriodSummarySource } from '../../diseaseHypotheses/savedSummaries';
import { healthContextRevision } from '../../healthEvidence/healthContext/scope';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createSymptomSummaryStorage } from '../symptomSummaryStorage';
import { legacySummaryPeriodAvailable } from '../legacySummaryPeriodQuarantine';

/** Simulate a backup from before the contributor fence: the row survived an old deletion. */
test('quarantines an old period without deleting its original summary or resurrecting it on reopen', async () => {
  const f = await healthContextFixture();
  try {
    await f.storage.list();
    const original = JSON.stringify(f.saved);
    await f.database.execute('DELETE FROM health_observations WHERE id = ?', [
      f.inside.id,
    ]);
    await f.database.execute(
      'INSERT INTO symptom_summary_runs (id, created_at, model_name, result_json) VALUES (?, ?, ?, ?)',
      [f.saved.id, f.saved.createdAt, f.saved.modelName, original],
    );
    const migrated = createSymptomSummaryStorage(f.database);
    expect(await migrated.list()).toEqual([
      {
        id: f.saved.id,
        createdAt: f.saved.createdAt,
        modelName: f.saved.modelName,
        unavailableReason: 'legacy_period_unverified',
      },
    ]);
    expect(await migrated.read(f.saved.id)).toBeNull();
    expect(await migrated.readWithStatus!(f.saved.id)).toEqual({
      status: 'unavailable',
      reason: 'legacy_period_unverified',
    });
    expect(await legacySummaryPeriodAvailable(f.database, f.saved)).toBe(false);
    await expect(
      assertConversationSummaryParent(f.database, f.database, {
        kind: 'generated_summary',
        id: f.saved.id,
        revision: fingerprint(f.saved),
        reference: {
          ...f.saved.sources[0]!.reference,
          sourceKind: 'generated_artifact',
          locator: { kind: 'generated_artifact', type: 'symptom_summary' },
        },
      }),
    ).rejects.toThrow('regenerated');
    expect(
      (
        await f.database.execute(
          'SELECT result_json FROM symptom_summary_runs WHERE id = ?',
          [f.saved.id],
        )
      ).rows[0]?.result_json,
    ).toBe(original);
    expect(
      await createSymptomSummaryStorage(f.database).read(f.saved.id),
    ).toBeNull();
    await expect(migrated.append(f.saved)).rejects.toThrow();
    const revision = fingerprint(f.saved);
    await expect(
      assertGeneratedVisitQuestionSource(
        {
          sourceKind: 'generated_artifact',
          sourceId: f.saved.id,
          evidenceId: f.saved.id,
          sourceRevision: revision,
          evidenceRevision: revision,
          locator: { kind: 'generated_artifact', type: 'symptom_summary' },
          effectiveTime: null,
          reviewState: 'unknown',
          content: 'synthetic summary',
        },
        {
          sourceRecordIds: [],
          sourceRecordRevisions: [],
          sourceDates: [],
          generatedArtifactSource: {
            kind: 'generated_summary',
            type: 'symptom_summary',
            id: f.saved.id,
            revision,
          },
        },
        f.database,
      ),
    ).rejects.toThrow('regenerated');

    expect(
      await revalidateSummaryArtifacts(f.database, [
        { id: f.saved.id, revision: fingerprint(f.saved) },
      ]),
    ).toBe(false);
  } finally {
    f.close();
  }
});

test('marks a newly saved summary with the current policy and keeps normal history readable', async () => {
  const f = await healthContextFixture();
  try {
    await f.storage.append(f.saved);
    expect(
      (
        await f.database.execute(
          'SELECT status FROM summary_period_policy WHERE summary_id = ?',
          [f.saved.id],
        )
      ).rows[0]?.status,
    ).toBe('current');
    expect(
      await createSymptomSummaryStorage(f.database).read(f.saved.id),
    ).toEqual(f.saved);
    expect(await legacySummaryPeriodAvailable(f.database, f.saved)).toBe(true);
  } finally {
    f.close();
  }
});

test('conservative old-policy quarantine preserves originals and permits a new identity from a fresh snapshot', async () => {
  const f = await healthContextFixture();
  try {
    await f.storage.list();
    // Simulate an unrelated historical deletion: old provenance cannot prove which row was deleted.
    await f.database.execute(
      'UPDATE health_context_generation SET deletions = deletions + 1, mutations = mutations + 1 WHERE singleton = 1',
    );
    await f.database.execute(
      'INSERT INTO symptom_summary_runs (id, created_at, model_name, result_json) VALUES (?, ?, ?, ?)',
      [
        f.saved.id,
        f.saved.createdAt,
        f.saved.modelName,
        JSON.stringify(f.saved),
      ],
    );
    const migrated = createSymptomSummaryStorage(f.database);
    expect(await migrated.read(f.saved.id)).toBeNull();
    expect(
      await revalidateSummaryArtifacts(f.database, [
        { id: f.saved.id, revision: fingerprint(f.saved) },
      ]),
    ).toBe(false);
    const sources = await Promise.all(
      f.saved.sources.map(async source => {
        if (!isPeriodSummarySource(source)) return source;
        const report = await f.read(source.scope.window, [source.scope.topic]);
        const revision = healthContextRevision(source.scope, report);
        return {
          ...source,
          revision,
          deletionGeneration: report.deletionGeneration,
          reference: {
            ...source.reference,
            sourceRevision: revision,
            evidenceRevision: revision,
          },
        };
      }),
    );
    const fresh = { ...f.saved, id: 'fresh-summary', sources };
    await migrated.append(fresh);
    expect(await migrated.read(fresh.id)).toEqual(fresh);
    expect(await migrated.read(f.saved.id)).toBeNull();
    expect(
      (await f.database.execute('SELECT id FROM symptom_summary_runs')).rows,
    ).toHaveLength(2);
  } finally {
    f.close();
  }
});

test('old summaries retain exact ingestion cutoffs when later imports arrive', async () => {
  const f = await healthContextFixture();
  try {
    await f.storage.list();
    const sources = await Promise.all(
      f.saved.sources.map(async source => {
        if (!isPeriodSummarySource(source)) return source;
        const scope = {
          ...source.scope,
          window: {
            ...source.scope.window,
            dataAvailableThrough: '2026-10-05T00:00:00Z',
          },
        };
        const report = await f.read(scope.window, [scope.topic]);
        const revision = healthContextRevision(scope, report);
        return {
          ...source,
          scope,
          revision,
          reference: {
            ...source.reference,
            locator: scope,
            sourceRevision: revision,
            evidenceRevision: revision,
          },
        };
      }),
    );
    const old = {
      ...f.saved,
      sources,
      analysis: {
        ...f.saved.analysis,
        hypotheses: f.saved.analysis.hypotheses.map(item => ({
          ...item,
          supportingEvidence: [sources[0]!.reference],
        })),
      },
    };
    await f.repository.put('health_observation', {
      ...f.inside,
      id: 'late-import',
      ingestedAt: '2026-11-01T00:00:00Z',
    });
    await f.database.execute(
      'INSERT INTO symptom_summary_runs (id, created_at, model_name, result_json) VALUES (?, ?, ?, ?)',
      [old.id, old.createdAt, old.modelName, JSON.stringify(old)],
    );
    expect(await createSymptomSummaryStorage(f.database).read(old.id)).toEqual(
      old,
    );
  } finally {
    f.close();
  }
});
