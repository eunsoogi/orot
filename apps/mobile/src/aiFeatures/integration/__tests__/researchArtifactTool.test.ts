import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createResearchArtifactStorage } from '../../../storage/researchArtifactStorage';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createSymptomSummaryStorage } from '../../../storage/symptomSummaryStorage';
import { createResearchArtifactDiscovery } from '../researchArtifactDiscovery';
import { createResearchArtifactTool } from '../researchArtifactTool';
import { createSummaryArtifactDiscovery } from '../summaryArtifactDiscovery';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { captureConversationSources } from '../captureConversationSources';
import { captureEvidenceSources } from '../captureEvidenceSources';
import { localData } from '../featureServiceFixtures';
import { saveReviewedVisitQuestions } from '../../../agent/visitQuestions/persistence';
import {
  localEvidenceFingerprint,
  visitQuestionCitationKey,
} from '../../../agent/visitQuestions/evidence';
import {
  appointment,
  candidate,
  now,
} from '../../../agent/visitQuestions/testing/persistenceFixtures';

test('a separate research snapshot is discoverable, readable and invalidates dependent artifacts on deletion', async () => {
  const db = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(db.database);
    const research = createResearchArtifactStorage(db.database);
    await research.append(
      [
        {
          createdAt: '2026-10-05T00:00:00.000Z',
          originFeature: 'record_conversation',
          providerId: 'provider',
          modelId: 'model',
          source: {
            kind: 'public_web_search',
            status: 'historical_snapshot',
            retrievedAt: '2026-10-05T00:00:00.000Z',
            sources: [
              {
                title: 'Synthetic guideline',
                url: 'https://example.org/guideline',
              },
            ],
          },
          generatedText: 'Generated interpretation of a public source.',
        },
      ],
      await research.currentGeneration(),
    );
    const registry = new LocalEvidenceReferenceRegistry();
    const data = Object.assign(localData([]).data, {
      researchArtifactDiscovery: async () =>
        createResearchArtifactDiscovery(
          createResearchArtifactStorage(db.database),
        ),
    });
    const tool = createResearchArtifactTool(data, registry);
    const signal = new AbortController().signal;
    const result = await tool.search({
      operationRunId: 'run',
      operationKey: 'research',
      input: { query: 'synthetic guideline' },
      allowedScope: { sourceKinds: ['generated_artifact'] },
      resultLimit: 4,
      maxPayloadBytes: 10000,
      signal,
    });
    if ('status' in result) throw new Error('Unexpected consent');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.content).toContain('not an original passage');
    const detail = await registry.readSource(result.items[0]!, signal);
    expect(
      detail.status === 'available' &&
        detail.document.sourceKind === 'generated_artifact' &&
        'research' in detail.document &&
        detail.document.research.generatedText,
    ).toContain('Generated interpretation');
    const conversationSource = await captureConversationSources(
      result.items,
      registry,
      signal,
    );
    const summarySource = await captureEvidenceSources(
      result.items,
      registry,
      signal,
    );
    const citation = conversationSource.mapping.get(
      JSON.stringify(result.items[0]),
    )!;
    const conversations = createConversationArtifactStorage(db.database);
    await conversations.createSession(
      'session',
      await conversations.currentGeneration(),
    );
    await conversations.append({
      id: 'child-turn',
      sessionId: 'session',
      createdAt: '2026-10-05T01:00:00.000Z',
      providerId: 'provider',
      modelId: 'model',
      status: 'complete',
      question: 'question',
      answer: 'answer',
      sources: conversationSource.sources,
      citations: [citation],
    });
    const summaries = createSymptomSummaryStorage(db.database);
    await summaries.append({
      id: 'child-summary',
      createdAt: '2026-10-05T01:00:00.000Z',
      modelName: 'Synthetic',
      modelId: 'model',
      providerId: 'provider',
      inputLineage: 'complete',
      analysis: {
        presentation: 'symptom_summary',
        hypotheses: [
          {
            title: 'Generated result',
            summary: 'Historical interpretation',
            uncertainty: '',
            missingData: [],
            supportingEvidence: [citation],
            contraryEvidence: [],
          },
        ],
      },
      sources: summarySource.sources,
    });
    expect(await conversations.read('child-turn')).not.toBeNull();
    expect(await summaries.read('child-summary')).not.toBeNull();
    const summaryDiscovery = createSummaryArtifactDiscovery({
      database: db.database,
      storage: summaries,
      data,
      registry,
    });
    expect((await summaryDiscovery.read('child-summary'))?.sourceStatus).toBe(
      'unknown',
    );
    const records = createRecordRepository(db.database);
    await records.put('appointment', appointment);
    const evidence = {
      ...citation,
      content: 'Generated interpretation of a public source.',
    };
    await saveReviewedVisitQuestions({
      appointmentId: appointment.id,
      expectedAppointmentRevision: localEvidenceFingerprint(appointment),
      questions: [{ ...candidate, citations: [evidence] }],
      evidence: {
        batch: { items: [evidence], coverage: [], conflicts: [] },
        metadataByCitation: new Map([
          [
            visitQuestionCitationKey(evidence),
            {
              sourceRecordIds: [],
              sourceRecordRevisions: [],
              sourceDates: [],
              generatedArtifactSource: {
                kind: 'generated_research',
                type: 'research_web_explanation',
                id: citation.sourceId,
                revision: citation.sourceRevision,
              },
            },
          ],
        ]),
        memoryStatus: 'no_matching_current_memory',
      },
      repository: records,
      memory: { remember: async () => undefined } as never,
      now,
      revalidateEvidence: async () => true,
    });
    expect(
      await records.get('visit_question', 'visit-question:appointment-1:1'),
    ).not.toBeNull();
    await research.remove(1);
    expect(await registry.readSource(result.items[0]!, signal)).toEqual({
      status: 'missing',
    });
    expect(await conversations.read('child-turn')).toBeNull();
    expect(await summaries.read('child-summary')).toBeNull();
    expect(
      await records.get('visit_question', 'visit-question:appointment-1:1'),
    ).toBeNull();
  } finally {
    db.close();
  }
});
