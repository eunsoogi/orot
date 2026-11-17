import { VisitQuestionCreateSchema } from '@orot/domain';
import { periodContributorFixture } from '../testSupport/periodContributorFixture';
import {
  readVisitPeriodPolicy,
  markCurrentVisitPeriod,
} from '../legacyVisitPeriodQuarantine';
import { assertHealthPeriodCurrent } from '../healthPeriodDependencies';
import { loadSavedVisitQuestionState } from '../../aiFeatures/integration/savedVisitQuestions';
import { createLocalHealthEvidenceRepository } from '../../healthEvidence/localEvidenceRepository';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';

/** Recreate an old encrypted question row without its removed contributor or any policy proof. */
test('visit quarantine preserves raw question, exposes only recovery, and new verified policy survives unrelated deletion', async () => {
  const f = await periodContributorFixture(
    'workout_duration',
    'measurements',
    true,
    true,
  );
  try {
    const source = {
      scope: f.source.scope,
      revision: f.source.revision,
      deletionGeneration: f.source.deletionGeneration,
    };
    const old = VisitQuestionCreateSchema.parse({
      id: 'synthetic-question',
      questionText: 'private old question',
      rationale: 'private rationale',
      priority: 'routine',
      position: 1,
      appointmentId: 'appointment',
      evidenceSpanIds: [],
      healthContextSources: [source],
      effectiveAt: '2026-10-05T00:00:00Z',
      recordedAt: '2026-10-05T00:00:00Z',
      ingestedAt: '2026-10-05T00:00:00Z',
      provenance: { origin: 'derived', sourceRecordIds: ['synthetic-period'] },
      reviewState: { status: 'unreviewed' },
    });
    await f.repository.delete('health_observation', 'candidate');
    await f.repository.put('visit_question', old);
    expect(await readVisitPeriodPolicy(f.repository, old)).toBe(false);
    const loaded = await loadSavedVisitQuestionState({
      appointmentId: 'appointment',
      records: f.repository,
      sourceReader: createLocalHealthEvidenceRepository(f.database),
      registry: new LocalEvidenceReferenceRegistry(),
      readHealthContext: f.read,
    });
    expect(loaded).toMatchObject({
      status: 'error',
      questions: [],
      failureReason: 'unverifiable_legacy_period',
    });
    expect(JSON.stringify(loaded)).not.toContain('private old');
    expect(loaded.status === 'error' && loaded.message).toContain('다시 생성');
    expect(await f.repository.get('visit_question', old.id)).toEqual(old);
    const report = await f.read(f.window, ['measurements']);
    const fresh = {
      ...old,
      id: 'regenerated-question',
      healthContextSources: [
        { ...source, deletionGeneration: report.deletionGeneration },
      ],
    };
    await f.repository.transaction(async (writer, tx) => {
      if (!tx) throw new Error('Missing transaction');
      await assertHealthPeriodCurrent(tx, fresh.healthContextSources[0]!);
      await writer.put('visit_question', fresh);
      await markCurrentVisitPeriod(tx, fresh);
    });
    await f.repository.put('health_observation', {
      ...f.candidate,
      id: 'unrelated',
      effectiveAt: '2026-08-01T00:00:00Z',
      endedAt: undefined,
    });
    await f.repository.delete('health_observation', 'unrelated');
    expect(await readVisitPeriodPolicy(f.repository, fresh)).toBe(true);
    expect(await readVisitPeriodPolicy(f.repository, old)).toBe(false);
    await f.repository.delete('health_observation', 'duplicate');
    expect(await f.repository.get('visit_question', old.id)).toBeNull();
  } finally {
    f.close();
  }
});
