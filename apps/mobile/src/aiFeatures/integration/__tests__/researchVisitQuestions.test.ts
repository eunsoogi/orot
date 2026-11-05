import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createResearchArtifactStorage } from '../../../storage/researchArtifactStorage';
import { createResearchArtifactDiscovery } from '../researchArtifactDiscovery';
import { createAiFeatureServices } from '../featureServices';
import { localData, consent } from '../featureServiceFixtures';
import { preparedContext } from '../../../agent/visitQuestions/testing/workflowFixtures';
import { candidate } from '../../../agent/visitQuestions/testing/persistenceFixtures';
import { saveVisitQuestionRoute } from '../visitQuestionsRouteSave';
import { saveReviewedVisitQuestions } from '../../../agent/visitQuestions/persistence';
import { localEvidenceFingerprint } from '../../../agent/visitQuestions/evidence';

test('visit questions discover and save a research parent through the production route', async () => {
  const db = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(db.database);
    const research = createResearchArtifactStorage(db.database);
    await research.append(
      [
        {
          createdAt: '2026-10-05T00:00:00.000Z',
          originFeature: 'medical_literature',
          providerId: null,
          modelId: null,
          source: {
            kind: 'publication',
            status: 'historical_snapshot',
            retrievedAt: '2026-10-05T00:00:00.000Z',
            title: 'Synthetic study for visit',
            url: 'https://europepmc.org/article/MED/123',
          },
          generatedText: null,
        },
      ],
      await research.currentGeneration(),
    );
    const data = Object.assign(localData([]).data, {
      researchArtifactDiscovery: async () =>
        createResearchArtifactDiscovery(
          createResearchArtifactStorage(db.database),
        ),
    });
    const services = createAiFeatureServices(consent, {
      loadLocalData: async () => data,
    });
    const generated = await services.generatedArtifactTools!();
    const tool = generated.tools.find(
      entry => entry.id === 'local-research-artifacts',
    );
    if (!tool) throw new Error('Missing research tool');
    const signal = new AbortController().signal;
    const found = await tool.search({
      operationRunId: 'visit',
      operationKey: 'search',
      input: { query: 'synthetic study for visit' },
      allowedScope: { sourceKinds: ['generated_artifact'] },
      resultLimit: 3,
      maxPayloadBytes: 10000,
      signal,
    });
    if ('status' in found) throw new Error('Unexpected consent');
    expect(found.items).toHaveLength(1);
    const source = found.items[0]!;
    const prepared = preparedContext();
    const records = createRecordRepository(db.database);
    await records.put('appointment', prepared.appointment);
    const result = await saveVisitQuestionRoute(
      {
        appointment: prepared.appointment,
        questions: [{ ...candidate, citations: [source] }],
        caveats: [],
        expectedSavedQuestions: [],
        resolveSource: services.resolveSource,
        validateGeneratedArtifact: (reference, currentSignal) =>
          generated.validate([reference], currentSignal),
      },
      async () => ({
        prepareUpcomingVisitQuestionContext: async options => {
          const evidence = {
            batch: { items: [], coverage: [], conflicts: [] },
            metadataByCitation: new Map(),
            memoryStatus: 'no_matching_current_memory' as const,
          };
          const revalidateEvidence = async (
            items: typeof candidate.citations,
          ) =>
            (
              await Promise.all(
                items.map(item =>
                  options.validateGeneratedArtifact!(item, {} as never),
                ),
              )
            ).every(Boolean);
          return {
            ...prepared,
            evidence,
            revalidateEvidence,
            saveReviewedQuestions: (questions: readonly (typeof candidate)[]) =>
              saveReviewedVisitQuestions({
                appointmentId: prepared.appointment.id,
                expectedSavedQuestions: [],
                expectedAppointmentRevision: localEvidenceFingerprint(
                  prepared.appointment,
                ),
                questions,
                evidence,
                repository: records,
                now: '2026-10-07T04:00:00.000Z',
                revalidateEvidence,
              }),
          } as never;
        },
      }),
    );
    expect(result.questions).toHaveLength(1);
    const questionId = 'synthetic-question-1';
    expect(await records.get('visit_question', questionId)).toMatchObject({
      generatedArtifactSources: [
        expect.objectContaining({
          kind: 'generated_research',
          type: 'research_publication',
        }),
      ],
    });
    await research.remove(1);
    expect(await records.get('visit_question', questionId)).toBeNull();
  } finally {
    db.close();
  }
});
