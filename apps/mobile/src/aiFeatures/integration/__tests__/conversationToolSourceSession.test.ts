import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { SqlCipherAgentMemoryStorage } from '../../../storage/agentMemoryStorage';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { reference } from '../../../diseaseHypotheses/taskTestSupport';
import { createConversationSessions } from '../../../ragConversation/conversationSessions';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { createConversationSessionOptions } from '../conversationSessionOptions';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData, memoryRecord } from '../featureServiceFixtures';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';

test('a tool-only conversation captures source lineage through the real session and restores a fresh alias', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-tool-session-'));
  const path = join(directory, 'records.sqlite');
  let connection = openSqliteTestDatabase(path);
  try {
    await runMigrations(connection.database);
    const record = memoryRecord(2);
    await new SqlCipherAgentMemoryStorage(connection.database).append(record);
    let storage = createConversationArtifactStorage(connection.database);
    const registry = new LocalEvidenceReferenceRegistry();
    const original = {
      ...reference,
      sourceKind: 'reviewed_memory' as const,
      sourceId: record.id,
      evidenceId: record.id,
    };
    const alias = registry.add({
      reference: original,
      content: record.text,
      validate: async () => true,
      readSource: async () => ({
        status: 'available',
        document: { sourceKind: 'reviewed_memory', record },
      }),
    });
    const data = localData([record]).data;
    const makeData = async () => ({
      ...data,
      openConversationArtifactStorage: async () => storage,
      conversationArtifactDiscovery: async (
        r: LocalEvidenceReferenceRegistry,
      ) =>
        createConversationArtifactDiscovery({
          database: connection.database,
          storage,
          registry: r,
          data,
        }),
    });
    const options = createConversationSessionOptions({
      registry,
      loadLocalData: makeData,
    });
    const sessions = createConversationSessions(options);
    sessions.setDraft(1, 'question');
    await sessions.send(1, async (_question, _history, _signal, observer) => {
      const {
        sourceKind,
        sourceId,
        sourceRevision,
        evidenceId,
        evidenceRevision,
      } = alias;
      observer!.onToolEvent!({
        version: 1,
        operationRunId: 'run',
        callId: 'call',
        toolName: 'memory',
        order: 1,
        status: 'completed',
        inputSummary: { sourceKind },
        resultSummary: { referenceCount: 1 },
        sources: [
          {
            sourceKind,
            sourceId,
            sourceRevision,
            evidenceId,
            evidenceRevision,
          },
        ],
      });
      observer!.onToolEvent!({
        version: 1,
        operationRunId: 'run',
        callId: 'call',
        toolName: 'memory',
        order: 1,
        status: 'completed',
        inputSummary: { sourceKind },
        sources: [
          {
            sourceKind,
            sourceId,
            sourceRevision,
            evidenceId: 'unknown-alias',
            evidenceRevision,
          },
        ],
      });
      return { status: 'failure', kind: 'unavailable' };
    });
    const sessionId = options.retention!.activeIdentity(1)!;
    const rows = await connection.database.execute(
      'SELECT event_json, sources_json FROM conversation_tool_events JOIN conversation_tool_lineage USING (session_id, run_id, call_id) WHERE session_id = ?',
      [sessionId],
    );
    expect(JSON.stringify(rows)).not.toContain(record.text);
    sessions.dispose();
    connection.close();
    connection = openSqliteTestDatabase(path);
    storage = createConversationArtifactStorage(connection.database);
    const fresh = new LocalEvidenceReferenceRegistry();
    const restored = await createConversationSessionOptions({
      registry: fresh,
      loadLocalData: makeData,
    }).restoreSession!(sessionId, new AbortController().signal);
    const toolAlias = fresh.resolveToolReference(
      restored[0]!.toolEvents![0]!.sources[0]!,
    )!;
    expect(fresh.resolve(toolAlias)).toMatchObject({ sourceId: record.id });
    expect(
      (await fresh.readSource(toolAlias, new AbortController().signal)).status,
    ).toBe('available');
    await storage.deleteSession(sessionId);
    expect(
      (await fresh.readSource(toolAlias, new AbortController().signal)).status,
    ).toBe('unavailable');
  } finally {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('source capture failure removes the started event and rejects late callbacks', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const record = memoryRecord(3);
    await new SqlCipherAgentMemoryStorage(connection.database).append(record);
    const storage = createConversationArtifactStorage(connection.database);
    const registry = new LocalEvidenceReferenceRegistry();
    const original = {
      ...reference,
      sourceKind: 'reviewed_memory' as const,
      sourceId: record.id,
      evidenceId: record.id,
    };
    const alias = registry.add({
      reference: original,
      content: '',
      validate: async () => false,
      readSource: async () => ({
        status: 'available',
        document: { sourceKind: 'reviewed_memory', record },
      }),
    });
    const data = localData([record]).data;
    const options = createConversationSessionOptions({
      registry,
      loadLocalData: async () => ({
        ...data,
        openConversationArtifactStorage: async () => storage,
      }),
    });
    const sessions = createConversationSessions(options);
    sessions.setDraft(1, 'question');
    const {
      sourceKind,
      sourceId,
      sourceRevision,
      evidenceId,
      evidenceRevision,
    } = alias;
    const started = {
      version: 1 as const,
      operationRunId: 'run',
      callId: 'call',
      toolName: 'memory',
      order: 1,
      status: 'started' as const,
      inputSummary: { sourceKind },
      sources: [],
    };
    await sessions.send(1, async (_question, _history, _signal, observer) => {
      observer!.onToolEvent!(started);
      observer!.onToolEvent!({
        ...started,
        status: 'completed',
        sources: [
          {
            sourceKind,
            sourceId,
            sourceRevision,
            evidenceId,
            evidenceRevision,
          },
        ],
      });
      return { status: 'failure', kind: 'unavailable' };
    });
    const sessionId = options.retention!.activeIdentity(1)!;
    expect(await storage.readToolTurns(sessionId)).toEqual([]);
    await expect(
      storage.appendToolEvent({
        sessionId,
        messageId: 'turn',
        createdAt: '2026-11-06T00:00:00.000Z',
        sessionVersion: 0,
        event: started,
      }),
    ).rejects.toThrow();
    sessions.dispose();
  } finally {
    connection.close();
  }
});
