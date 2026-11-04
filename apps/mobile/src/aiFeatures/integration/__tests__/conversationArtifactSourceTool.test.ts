import { createManualHistoryRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { reference } from '../../../diseaseHypotheses/taskTestSupport';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';
import { fingerprint } from '../evidenceUtils';
import { restoreConversationArtifact } from '../restoreConversationArtifact';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { registerArtifactSource } from '../artifactLineage';
import { createArtifactSourceTool } from '../artifactSourceTool';

test('follows a conversation source through its own catalog and revokes it when the parent is deleted', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const history = createManualHistoryRepository(connection.database);
    const entry = await history.create({
      kind: 'note',
      title: 'Synthetic',
      details: 'Synthetic history',
      effectiveDate: { status: 'unknown' },
    });
    const evidence = await history.getEvidence(entry.id);
    const storage = createConversationArtifactStorage(connection.database);
    await storage.createSession('session', await storage.currentGeneration());
    await storage.append({
      id: 'shared-id',
      sessionId: 'session',
      createdAt: '2035-01-01T00:00:00.000Z',
      providerId: 'provider',
      modelId: 'model',
      status: 'complete',
      question: 'question',
      answer: 'answer',
      sources: [
        {
          reference,
          records: [
            {
              kind: 'manual_history',
              id: entry.id,
              revision: fingerprint(evidence),
            },
          ],
        },
      ],
      citations: [reference],
    });
    const registry = new LocalEvidenceReferenceRegistry();
    const wrongCatalog = jest.fn(async () => {
      throw new Error('wrong catalog');
    });
    const data = Object.assign(localData([]).data, {
      manualHistory: history,
      findIdentifiers: async () => [entry.id],
      summaryArtifactDiscovery: wrongCatalog,
      conversationArtifactDiscovery: async (
        currentRegistry: LocalEvidenceReferenceRegistry,
      ) =>
        createConversationArtifactDiscovery({
          database: connection.database,
          storage,
          data,
          registry: currentRegistry,
        }),
    });
    const restored = await restoreConversationArtifact({
      id: 'shared-id',
      storage,
      registry,
      data,
      signal: new AbortController().signal,
    });
    if (!restored) throw new Error('Missing conversation');
    const source = restored.sources[0]!;
    registerArtifactSource(registry, 'run', source, {
      id: restored.id,
      revision: restored.revision,
      sourceStatus: restored.sourceStatus,
      catalog: 'conversation',
    });
    const tool = createArtifactSourceTool('personal_record', data, registry);
    const request = {
      operationRunId: 'run',
      operationKey: 'follow',
      input: { evidenceId: source.evidenceId },
      allowedScope: { sourceKinds: ['personal_record' as const] },
      resultLimit: 1,
      maxPayloadBytes: 20000,
      signal: new AbortController().signal,
    };
    const result = await tool.search(request);
    if ('status' in result) throw new Error('Unexpected consent result');
    expect(result.items[0]?.content).toContain('Synthetic history');
    expect(result.items[0]?.content).not.toContain(entry.id);
    expect(wrongCatalog).not.toHaveBeenCalled();
    const original = await storage.read('shared-id');
    await connection.database.execute(
      'UPDATE conversation_artifacts SET result_json = ? WHERE id = ?',
      [JSON.stringify({ ...original, answer: 'revised' }), 'shared-id'],
    );
    await expect(tool.search(request)).rejects.toThrow('unavailable');
    await connection.database.execute(
      'UPDATE conversation_artifacts SET result_json = ? WHERE id = ?',
      [JSON.stringify(original), 'shared-id'],
    );
    jest.spyOn(data, 'findIdentifiers').mockImplementationOnce(async () => {
      await storage.deleteSession('session');
      return [];
    });
    await expect(tool.search(request)).rejects.toThrow('unavailable');
    await expect(tool.search(request)).rejects.toThrow('unavailable');
  } finally {
    connection.close();
  }
});
