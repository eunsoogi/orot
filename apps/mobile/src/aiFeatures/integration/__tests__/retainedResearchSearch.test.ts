import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createSymptomSummaryStorage } from '../../../storage/symptomSummaryStorage';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { createSummaryArtifactDiscovery } from '../summaryArtifactDiscovery';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';
import { createSummaryArtifactTool } from '../summaryArtifactTool';
import { createConversationArtifactTool } from '../conversationArtifactTool';
import {
  retainedResearchMetadata,
  retainedResearchSearchText,
} from '../retainedResearchSearch';

test('retains only validated public links and exposes nested web source titles', () => {
  const web = {
    sourceKind: 'external_medical' as const,
    sourceId: 'public-web',
    sourceRevision: '1',
    evidenceId: 'web',
    evidenceRevision: '1',
    locator: {
      kind: 'public_web_search',
      sources: [
        {
          title: 'Synthetic public article',
          url: 'https://example.org/article',
        },
      ],
    },
    effectiveTime: null,
    reviewState: 'unknown' as const,
  };
  expect(
    retainedResearchSearchText([{ reference: web, records: [] }]),
  ).toContain('synthetic public article');
  expect(retainedResearchMetadata([web])).toEqual([
    expect.objectContaining({
      kind: 'public_web_search',
      status: 'historical_snapshot',
    }),
  ]);
  const invalid = {
    ...web,
    locator: {
      kind: 'public_web_search',
      sources: [{ title: 'unsafe', url: 'file:///private' }],
    },
  };
  expect(retainedResearchMetadata([invalid])).toEqual([]);
  expect(
    retainedResearchSearchText([{ reference: invalid, records: [] }]),
  ).toBe('');
});

test('discovers retained publication titles through their saved summary and conversation', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const reference = {
      sourceKind: 'external_medical' as const,
      sourceId: 'europe-pmc',
      sourceRevision: 'retrieved:2026-10-05',
      evidenceId: 'MED:123',
      evidenceRevision: 'snapshot:1',
      locator: {
        provider: 'Europe PMC',
        title: 'Unique synthetic publication',
        source: 'MED',
        recordId: '123',
        originalUrl: 'https://europepmc.org/article/MED/123',
        retrievedAt: '2026-10-05T00:00:00.000Z',
        abstract: 'Unlicensed synthetic abstract must not be retained',
      },
      effectiveTime: null,
      reviewState: 'unknown' as const,
    };
    const conversations = createConversationArtifactStorage(
      connection.database,
    );
    await conversations.createSession(
      'session',
      await conversations.currentGeneration(),
    );
    await conversations.append({
      id: 'conversation',
      sessionId: 'session',
      createdAt: '2026-10-05T00:00:00.000Z',
      providerId: 'provider',
      modelId: 'model',
      status: 'complete',
      question: 'General question',
      answer: 'General answer',
      sources: [{ reference, records: [] }],
      citations: [reference],
    });
    const summaries = createSymptomSummaryStorage(connection.database);
    await summaries.append({
      id: 'summary',
      createdAt: '2026-10-05T00:01:00.000Z',
      modelName: 'Synthetic',
      modelId: 'model',
      providerId: 'provider',
      inputLineage: 'complete',
      analysis: {
        presentation: 'symptom_summary',
        hypotheses: [
          {
            title: 'Earlier result',
            summary: 'General interpretation.',
            uncertainty: '',
            missingData: [],
            supportingEvidence: [reference],
            contraryEvidence: [],
          },
        ],
      },
      sources: [{ reference, records: [] }],
    });
    await summaries.append({
      id: 'legacy-summary',
      createdAt: '2026-10-05T00:02:00.000Z',
      modelName: 'Synthetic',
      modelId: 'model',
      providerId: 'provider',
      analysis: {
        presentation: 'symptom_summary',
        hypotheses: [
          {
            title: 'Legacy',
            summary: 'Earlier interpretation.',
            uncertainty: '',
            missingData: [],
            supportingEvidence: [reference],
            contraryEvidence: [],
          },
        ],
      },
      sources: [{ reference, records: [] }],
    });
    const registry = new LocalEvidenceReferenceRegistry();
    const data = Object.assign(localData([]).data, {
      summaryArtifactDiscovery: async (r: LocalEvidenceReferenceRegistry) =>
        createSummaryArtifactDiscovery({
          database: connection.database,
          storage: summaries,
          data,
          registry: r,
        }),
      conversationArtifactDiscovery: async (
        r: LocalEvidenceReferenceRegistry,
      ) =>
        createConversationArtifactDiscovery({
          database: connection.database,
          storage: conversations,
          data,
          registry: r,
        }),
    });
    const summary = createSummaryArtifactDiscovery({
      database: connection.database,
      storage: summaries,
      data,
      registry,
    });
    const conversation = createConversationArtifactDiscovery({
      database: connection.database,
      storage: conversations,
      data,
      registry,
    });
    const summaryPage = await summary.search({
      query: 'unique synthetic publication',
      limit: 10,
    });
    expect(summaryPage.items.map(item => item.id)).toEqual(['summary']);
    expect(summaryPage.unavailableCount).toBe(1);
    expect(
      (
        await conversation.search({
          query: 'unique synthetic publication',
          limit: 10,
        })
      ).items.map(item => item.id),
    ).toEqual(['conversation']);
    expect((await summary.read('summary'))?.sourceStatus).toBe('unknown');
    for (const tool of [
      createSummaryArtifactTool(data, registry),
      createConversationArtifactTool(data, registry),
    ]) {
      const result = await tool.search({
        operationRunId: 'research',
        operationKey: tool.id,
        input: { query: 'unique synthetic publication' },
        allowedScope: { sourceKinds: ['generated_artifact'] },
        resultLimit: 8,
        maxPayloadBytes: 20000,
        signal: new AbortController().signal,
      });
      if ('status' in result) throw new Error('Unexpected consent');
      expect(result.items[0]?.content).toContain(
        'https://europepmc.org/article/MED/123',
      );
      expect(result.items[0]?.content).toContain('historical_snapshot');
      expect(result.items[0]?.content).toContain('2026-10-05T00:00:00.000Z');
      expect(result.items[0]?.content).not.toContain(
        'Unlicensed synthetic abstract must not be retained',
      );
    }
    await connection.database.execute(
      'INSERT INTO conversation_invalid_summaries (id) VALUES (?)',
      ['summary'],
    );
    expect(
      (
        await summary.search({
          query: 'unique synthetic publication',
          limit: 10,
        })
      ).items,
    ).toEqual([]);
    await conversations.deleteSession('session');
    expect(
      (
        await conversation.search({
          query: 'unique synthetic publication',
          limit: 10,
        })
      ).items,
    ).toEqual([]);
  } finally {
    connection.close();
  }
});
