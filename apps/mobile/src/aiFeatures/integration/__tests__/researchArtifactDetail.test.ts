import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createResearchArtifactStorage } from '../../../storage/researchArtifactStorage';
import { createResearchArtifactDiscovery } from '../researchArtifactDiscovery';
import { createResearchArtifactTool } from '../researchArtifactTool';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';
import { retainLiteratureResults } from '../researchRetention';
import { presentEvidenceSource } from '../evidenceSourcePresentation';

test('publication detail preserves the public snapshot without inventing an abstract', async () => {
  const db = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(db.database);
    const research = createResearchArtifactStorage(db.database);
    const data = Object.assign(localData([]).data, {
      openResearchArtifactStorage: async () => research,
      researchArtifactDiscovery: async () =>
        createResearchArtifactDiscovery(
          createResearchArtifactStorage(db.database),
        ),
    });
    const service = retainLiteratureResults(
      {
        search: async () => ({
          status: 'available',
          publications: [
            {
              provider: 'Europe PMC',
              source: 'MED',
              recordId: '123',
              title: 'Publication for detail',
              authors: null,
              journal: null,
              publicationDate: '2024-01-01',
              updatedDate: null,
              abstract: 'Synthetic original abstract',
              originalUrl: 'https://europepmc.org/article/MED/123',
              retrievedAt: '2026-10-05T00:00:00.000Z',
            },
          ],
        }),
      },
      async () => data,
    );
    await service.search('public terms', { externalQueryConsented: true });
    const registry = new LocalEvidenceReferenceRegistry();
    const signal = new AbortController().signal;
    const result = await createResearchArtifactTool(data, registry).search({
      operationRunId: 'run',
      operationKey: 'research',
      input: { query: 'publication for detail' },
      allowedScope: { sourceKinds: ['generated_artifact'] },
      resultLimit: 2,
      maxPayloadBytes: 10000,
      signal,
    });
    if ('status' in result) throw new Error('Unexpected consent');
    expect(result.items[0]?.content).toContain('Citation metadata only');
    const detail = await registry.readSource(result.items[0]!, signal);
    if (
      detail.status !== 'available' ||
      detail.document.sourceKind !== 'generated_artifact' ||
      !('research' in detail.document)
    )
      throw new Error('Missing research detail');
    expect(detail.document.sources[0]?.locator).toMatchObject({
      originalUrl: 'https://europepmc.org/article/MED/123',
      publicationDate: '2024-01-01',
    });
    expect(detail.document.sourceStatus).toBe('unknown');
    expect(JSON.stringify(detail)).not.toContain('Synthetic original abstract');
    expect(JSON.stringify(presentEvidenceSource(detail.document))).toContain(
      '초록 원문은 저장되지 않았습니다',
    );
  } finally {
    db.close();
  }
});

test('bounded research search pages older results and rejects a changed source', async () => {
  const db = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(db.database);
    const storage = createResearchArtifactStorage(db.database);
    const snapshot = {
      createdAt: '2026-10-05T00:00:00.000Z',
      originFeature: 'record_conversation',
      providerId: 'provider',
      modelId: 'model',
      source: {
        kind: 'public_web_search' as const,
        sources: [
          { title: 'Long synthetic result', url: 'https://example.org' },
        ],
        status: 'historical_snapshot' as const,
        retrievedAt: '2026-10-05T00:00:00.000Z',
      },
      generatedText: 'Generated explanation '.repeat(150),
    };
    await storage.append(
      [snapshot, snapshot],
      await storage.currentGeneration(),
    );
    const data = Object.assign(localData([]).data, {
      researchArtifactDiscovery: async () =>
        createResearchArtifactDiscovery(
          createResearchArtifactStorage(db.database),
        ),
    });
    const registry = new LocalEvidenceReferenceRegistry();
    const tool = createResearchArtifactTool(data, registry);
    const request = {
      operationRunId: 'same-run',
      operationKey: 'search',
      input: { query: 'long synthetic' },
      allowedScope: { sourceKinds: ['generated_artifact' as const] },
      resultLimit: 2,
      maxPayloadBytes: 2048,
      signal: new AbortController().signal,
    };
    const first = await tool.search(request);
    if ('status' in first) throw new Error('Unexpected consent');
    expect(first.items).toHaveLength(1);
    expect(first.coverage[0]?.nextCursor).toBeDefined();
    const cursor = first.coverage[0]!.nextCursor!;
    const next = await tool.search({
      ...request,
      input: { query: 'long synthetic', cursor },
    });
    if ('status' in next) throw new Error('Unexpected consent');
    expect(next.items).toHaveLength(1);
    expect(next.items[0]?.evidenceId).not.toBe(first.items[0]?.evidenceId);
    await expect(
      tool.search({
        ...request,
        operationRunId: 'other-run',
        input: { query: 'long synthetic', cursor },
      }),
    ).rejects.toThrow('cursor');
    const original = await db.database.execute(
      'SELECT snapshot_json FROM research_artifacts WHERE id = ?',
      [2],
    );
    await db.database.execute(
      'UPDATE research_artifacts SET snapshot_json = json_set(snapshot_json, ?, ?) WHERE id = ?',
      ['$.generatedText', 'Changed output', 2],
    );
    expect(
      (await registry.readSource(first.items[0]!, request.signal)).status,
    ).toBe('missing');
    await db.database.execute(
      'UPDATE research_artifacts SET snapshot_json = ? WHERE id = ?',
      [original.rows[0]!.snapshot_json, 2],
    );
    expect(
      (await registry.readSource(first.items[0]!, request.signal)).status,
    ).toBe('missing');
  } finally {
    db.close();
  }
});
