import { periodContributorFixture } from '../../../storage/testSupport/periodContributorFixture';
import { SqlCipherAgentMemoryStorage } from '../../../storage/agentMemoryStorage';
import { reference } from '../../../diseaseHypotheses/taskTestSupport';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData, memoryRecord } from '../featureServiceFixtures';
import { captureConversationToolSources } from '../captureConversationToolSources';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { createConversationSessionStorage } from '../conversationSessionStorage';
import { conversationHistoryPageOption } from '../conversationHistoryPageOption';

test('a tool with an unavailable memory parent restores as metadata without poisoning a valid turn', async () => {
  const f = await periodContributorFixture(
    'workout_duration',
    'measurements',
    true,
    true,
  );
  try {
    const memory = memoryRecord(1);
    memory.meta = {
      ...memory.meta,
      provenance: {
        sourceIds: ['generated-artifact:generated_research:research-1'],
        sourceDates: [],
        reviewState: 'human_reviewed',
      },
    };
    await new SqlCipherAgentMemoryStorage(f.database).append(memory);
    const storage = f.conversation;
    await storage.createSession('diagnosis', await storage.currentGeneration());
    const registry = new LocalEvidenceReferenceRegistry();
    const alias = registry.add({
      reference: {
        ...reference,
        sourceKind: 'reviewed_memory',
        sourceId: memory.id,
        evidenceId: memory.id,
      },
      content: '',
      validate: async () => true,
      readSource: async () => ({
        status: 'available',
        document: { sourceKind: 'reviewed_memory', record: memory },
      }),
    });
    const captured = await captureConversationToolSources(
      {
        version: 1,
        operationRunId: 'run-diagnosis',
        callId: 'call-diagnosis',
        toolName: 'memory',
        order: 1,
        status: 'completed',
        inputSummary: { sourceKind: 'reviewed_memory' },
        resultSummary: { referenceCount: 1 },
        sources: [alias],
      },
      registry,
    );
    await storage.appendToolEvent({
      sessionId: 'diagnosis',
      messageId: 'older-tool',
      createdAt: '2026-10-05T00:00:00.000Z',
      sessionVersion: 0,
      ...captured,
    });
    await storage.append({
      id: 'healthy',
      sessionId: 'diagnosis',
      createdAt: '2026-10-06T00:00:00.000Z',
      providerId: 'synthetic',
      modelId: 'synthetic',
      status: 'complete',
      question: 'Safe new question',
      answer: 'Safe new answer',
      citations: [],
      sources: [],
    });
    const local = localData([memory]);
    const data = {
      ...local.data,
      readHealthContext: f.read,
      openConversationArtifactStorage: async () => storage,
    };
    const discovery = createConversationArtifactDiscovery({
      database: f.database,
      storage,
      registry,
      data,
    });
    data.conversationArtifactDiscovery = async () => discovery;
    const input = { loadLocalData: async () => data, registry };
    const page = conversationHistoryPageOption(
      input,
      createConversationSessionStorage(input.loadLocalData),
    );
    const signal = new AbortController().signal;
    const initial = await page('diagnosis', signal);
    expect(initial.turns).toHaveLength(2);
    const tool = initial.turns.find(
      turn => turn.toolMessageId === 'older-tool',
    )!;
    const bound = registry.resolveToolReference(
      tool.toolEvents![0]!.sources[0]!,
    )!;
    // A transient unavailable local projection is only a notice, never a durable quarantine.
    local.replaceMemoryRecords([]);
    expect((await page('diagnosis', signal)).turns[0]?.historyUnavailable).toBe(
      true,
    );
    local.replaceMemoryRecords([memory]);
    expect(
      (await page('diagnosis', signal)).turns[0]?.historyUnavailable,
    ).toBeUndefined();
    const loadMemory = jest
      .spyOn(data, 'loadMemoryRecords')
      .mockRejectedValueOnce(new Error('synthetic operational failure'));
    await expect(page('diagnosis', signal)).rejects.toThrow(
      'synthetic operational failure',
    );
    loadMemory.mockRestore();
    const version = (await storage.activeSessionVersion('diagnosis'))!;
    const before = await storage.listTimeline('diagnosis', version);
    await f.database.execute(
      "UPDATE research_period_policy SET status='quarantined' WHERE artifact_id=1",
    );
    expect(await storage.read('healthy')).not.toBeNull();
    expect(await storage.listTimeline('diagnosis', version)).toEqual(before);
    expect(await storage.readUnavailableToolMetadata('diagnosis')).toEqual([]);
    await expect(storage.readToolTurns('diagnosis', version)).rejects.toThrow(
      'parent',
    );
    expect((await registry.readSource(bound, signal)).status).not.toBe(
      'available',
    );
    const restored = await page('diagnosis', signal);
    expect(restored.turns.map(turn => turn.toolMessageId)).toEqual([
      'older-tool',
      'healthy',
    ]);
    expect(restored.turns[0]).toMatchObject({
      historyUnavailable: true,
      question: '',
      citations: [],
      toolEvents: [],
    });
    expect(JSON.stringify(restored.turns[0])).not.toContain(memory.text);
    expect(restored.turns[1]?.answer).toBe('Safe new answer');
    expect(
      (
        await f.database.execute(
          "SELECT status FROM tool_period_policy WHERE run_id='run-diagnosis'",
        )
      ).rows[0]?.status,
    ).toBe('current');
    expect(
      (
        await f.database.execute(
          "SELECT message_id FROM conversation_tool_events WHERE session_id='diagnosis'",
        )
      ).rows,
    ).toHaveLength(1);
    // Tool notice state is ephemeral; the established exact-memory parent audit is not.
    expect(
      (
        await f.database.execute(
          'SELECT memory_id FROM memory_parent_quarantine WHERE memory_id=?',
          [memory.id],
        )
      ).rows,
    ).toEqual([{ memory_id: memory.id }]);
    expect(
      (
        await f.database.execute(
          'SELECT id FROM agent_memory_records WHERE id=?',
          [memory.id],
        )
      ).rows,
    ).toHaveLength(1);
    const memoryStorage = new SqlCipherAgentMemoryStorage(f.database);
    const reviewed = {
      ...memory,
      meta: {
        ...memory.meta,
        provenance: {
          sourceIds: ['new-reviewed-source'],
          sourceDates: [],
          reviewState: 'human_reviewed',
        },
      },
    };
    await expect(memoryStorage.append(reviewed)).rejects.toThrow();
    await memoryStorage.append({ ...reviewed, id: 'new-reviewed-memory' });
    expect(
      (await memoryStorage.listRecords()).map(record => record.id),
    ).toEqual(['new-reviewed-memory']);
    // An independent artifact keeps the timeline key stable when its unavailable tool disappears.
    await storage.append({
      id: 'older-tool',
      sessionId: 'diagnosis',
      createdAt: '2026-10-05T00:00:00.000Z',
      providerId: 'synthetic',
      modelId: 'synthetic',
      status: 'complete',
      question: 'Independent question',
      answer: 'Independent answer',
      citations: [],
      sources: [],
    });
    const snapshot = storage.readToolTurnsSnapshot.bind(storage);
    jest
      .spyOn(storage, 'readToolTurnsSnapshot')
      .mockImplementationOnce(snapshot)
      .mockImplementationOnce(async (...args) => {
        const capturedSnapshot = await snapshot(...args);
        await f.database.execute(
          "DELETE FROM conversation_tool_events WHERE session_id='diagnosis'",
        );
        return capturedSnapshot;
      });
    await expect(page('diagnosis', signal)).rejects.toThrow('changed');
    expect(await storage.listTimeline('diagnosis', version)).toEqual(before);
  } finally {
    jest.restoreAllMocks();
    f.close();
  }
});
