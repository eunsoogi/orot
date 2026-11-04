import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createResearchArtifactStorage } from '../../../storage/researchArtifactStorage';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createResearchArtifactDiscovery } from '../researchArtifactDiscovery';
import { createRagConversationService } from '../ragConversationService';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';
import type { runRagConversationTurn } from '../../../ragConversation/service';

test('conversation workflow carries previous research into a free-form result and binds its session', async () => {
  const db = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(db.database);
    const storage = createResearchArtifactStorage(db.database);
    await storage.append(
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
            title: 'Synthetic publication',
            url: 'https://europepmc.org/article/MED/123',
          },
          generatedText: null,
        },
      ],
      await storage.currentGeneration(),
    );
    const conversations = createConversationArtifactStorage(db.database);
    await conversations.createSession(
      'session',
      await conversations.currentGeneration(),
    );
    const data = Object.assign(localData([]).data, {
      openResearchArtifactStorage: async () => storage,
      researchArtifactDiscovery: async () =>
        createResearchArtifactDiscovery(
          createResearchArtifactStorage(db.database),
        ),
    });
    const run = publicEvidenceFixture();
    const service = createRagConversationService({
      consent: run.consent,
      queryConsent: { authorize: async () => 'authorized' },
      externalEvidence: { search: async () => ({ status: 'empty' }) },
      loadLocalData: async () => data,
      selectedAi: async () => run.selected,
      registry: new LocalEvidenceReferenceRegistry(),
      ragRunner: (async (
        options: Parameters<typeof runRagConversationTurn>[0],
      ) => {
        const local = options.workflow.tools.find(
          tool => tool.id === 'local-research-artifacts',
        );
        const web = options.workflow.tools.find(
          tool => tool.id === 'public-web-search',
        );
        if (!local || !web) throw new Error('Missing production tools');
        await local.search({
          ...run.request,
          input: { query: 'synthetic publication' },
          allowedScope: { sourceKinds: ['generated_artifact'] },
        });
        await web.search(run.request);
        await web.search({ ...run.request, operationKey: 'second-web-search' });
        return { status: 'no_evidence' };
      }) as never,
    });
    await service('Synthetic question', [], undefined, {
      retentionSession: { id: 'session', version: 0 },
    });
    const saved = (await storage.search('synthetic guideline', null, 10))
      .items[0];
    expect(saved?.originSession).toBe('session');
    expect(saved?.inputSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'generated_research',
          id: 'research-1',
        }),
        expect.objectContaining({
          kind: 'generated_research',
          id: 'research-2',
        }),
      ]),
    );
    await db.database.execute(
      'DELETE FROM research_artifacts WHERE id = ?',
      [1],
    );
    const remaining = (await storage.search('synthetic guideline', null, 10))
      .items;
    expect(remaining.map(item => item.id)).not.toContain(saved!.id);
    expect(
      remaining.every(
        item =>
          !item.inputSources?.some(
            source =>
              'kind' in source &&
              source.kind === 'generated_research' &&
              source.id === 'research-1',
          ),
      ),
    ).toBe(true);
  } finally {
    db.close();
  }
});

test('conversation literature snapshots retain their real origin and session without abstract text', async () => {
  const db = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(db.database);
    const storage = createResearchArtifactStorage(db.database);
    const conversations = createConversationArtifactStorage(db.database);
    await conversations.createSession(
      'session',
      await conversations.currentGeneration(),
    );
    const data = Object.assign(localData([]).data, {
      openResearchArtifactStorage: async () => storage,
      researchArtifactDiscovery: async () =>
        createResearchArtifactDiscovery(
          createResearchArtifactStorage(db.database),
        ),
    });
    const run = publicEvidenceFixture();
    const service = createRagConversationService({
      consent: run.consent,
      queryConsent: { authorize: async () => 'authorized' },
      externalEvidence: {
        search: async () => ({
          status: 'available',
          publications: [
            {
              provider: 'Europe PMC',
              source: 'MED',
              recordId: '123',
              title: 'Origin synthetic study',
              authors: null,
              journal: null,
              publicationDate: null,
              updatedDate: null,
              abstract: 'Original abstract must not persist',
              originalUrl: 'https://europepmc.org/article/MED/123',
              retrievedAt: '2026-10-05T00:00:00.000Z',
            },
          ],
        }),
      },
      loadLocalData: async () => data,
      selectedAi: async () => run.selected,
      registry: new LocalEvidenceReferenceRegistry(),
      ragRunner: (async (
        options: Parameters<typeof runRagConversationTurn>[0],
      ) => {
        const literature = options.workflow.tools.find(
          tool => tool.id === 'europe-pmc-publication-search',
        );
        if (!literature) throw new Error('Missing literature tool');
        await literature.search({
          ...run.request,
          allowedScope: { sourceKinds: ['external_medical'] },
        });
        const web = options.workflow.tools.find(
          tool => tool.id === 'public-web-search',
        );
        if (!web) throw new Error('Missing web tool');
        await web.search({
          ...run.request,
          operationKey: 'web-after-literature',
        });
        return { status: 'no_evidence' };
      }) as never,
    });
    await service('Synthetic question', [], undefined, {
      retentionSession: { id: 'session', version: 0 },
    });
    const saved = (await storage.search('origin synthetic study', null, 10))
      .items[0];
    expect(saved).toMatchObject({
      originFeature: 'record_conversation',
      originSession: 'session',
      generatedText: null,
      providerId: run.selected.provider.id,
      modelId: run.selected.modelId,
    });
    expect(JSON.stringify(saved)).not.toContain(
      'Original abstract must not persist',
    );
    const webResult = (await storage.search('synthetic guideline', null, 10))
      .items[0];
    expect(webResult?.inputSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'generated_research',
          id: `research-${saved!.id}`,
        }),
      ]),
    );
    await storage.remove(saved!.id);
    const remaining = (await storage.search('synthetic guideline', null, 10))
      .items;
    expect(remaining.map(item => item.id)).not.toContain(webResult!.id);
    expect(
      remaining.every(
        item =>
          !item.inputSources?.some(
            source =>
              'kind' in source &&
              source.kind === 'generated_research' &&
              source.id === `research-${saved!.id}`,
          ),
      ),
    ).toBe(true);
  } finally {
    db.close();
  }
});
