import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { SqlCipherAgentMemoryStorage } from '../../../storage/agentMemoryStorage';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { reference } from '../../../diseaseHypotheses/taskTestSupport';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { createConversationSessionOptions } from '../conversationSessionOptions';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { fingerprint } from '../evidenceUtils';
import { localData, memoryRecord } from '../featureServiceFixtures';
import { captureConversationToolSources } from '../captureConversationToolSources';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';

test('restored tool references resolve to the same source as the retained citation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-tool-source-'));
  const path = join(directory, 'records.sqlite');
  let connection = openSqliteTestDatabase(path);
  try {
    await runMigrations(connection.database);
    const record = memoryRecord(1);
    await new SqlCipherAgentMemoryStorage(connection.database).append(record);
    let storage = createConversationArtifactStorage(connection.database);
    await storage.createSession('session', await storage.currentGeneration());
    const original = {
      ...reference,
      sourceKind: 'reviewed_memory' as const,
      sourceId: record.id,
      evidenceId: record.id,
    };
    const oldRegistry = new LocalEvidenceReferenceRegistry();
    for (let i = 0; i < 5; i++)
      oldRegistry.add({
        reference: original,
        content: '',
        validate: async () => true,
        readSource: async () => ({ status: 'unavailable' }),
      });
    const oldAlias = oldRegistry.add({
      reference: original,
      content: '',
      validate: async () => true,
      readSource: async () => ({
        status: 'available',
        document: { sourceKind: 'reviewed_memory', record },
      }),
    });
    const {
      sourceKind,
      sourceId,
      sourceRevision,
      evidenceId,
      evidenceRevision,
    } = oldAlias;
    expect(
      oldRegistry.resolveToolReference({
        sourceKind,
        sourceId,
        sourceRevision,
        evidenceId,
        evidenceRevision,
      }),
    ).toMatchObject({
      evidenceId: oldAlias.evidenceId,
      locator: oldAlias.locator,
    });
    const createdAt = '2026-11-06T00:00:00.000Z';
    const captured = await captureConversationToolSources(
      {
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
      },
      oldRegistry,
    );
    const dependency = captured.dependencies[0]!;
    if (!('records' in dependency))
      throw new Error('Expected a record source.');
    await storage.appendToolEvent({
      sessionId: 'session',
      messageId: 'turn',
      createdAt,
      sessionVersion: 0,
      ...captured,
      dependencies: [
        {
          ...dependency,
          privateExtra: 'SECRET_DEPENDENCY',
          reference: {
            ...dependency.reference,
            hidden: 'SECRET_REFERENCE',
          } as typeof dependency.reference,
          records: dependency.records.map(item => ({
            ...item,
            content: 'SECRET_RECORD',
          })),
        } as typeof dependency,
      ],
    });
    expect(
      JSON.stringify(
        (
          await connection.database.execute(
            'SELECT sources_json FROM conversation_tool_lineage',
          )
        ).rows,
      ),
    ).not.toMatch(/SECRET_/);
    await storage.append({
      id: 'turn',
      sessionId: 'session',
      createdAt,
      providerId: 'provider',
      modelId: 'model',
      status: 'complete',
      question: 'question',
      answer: 'answer',
      citations: [original],
      sources: [
        {
          reference: original,
          records: [
            {
              kind: 'reviewed_memory',
              id: record.id,
              revision: fingerprint({ text: record.text, meta: record.meta }),
            },
          ],
        },
      ],
    });
    connection.close();
    connection = openSqliteTestDatabase(path);
    storage = createConversationArtifactStorage(connection.database);
    const registry = new LocalEvidenceReferenceRegistry();
    const data = localData([record]).data;
    const options = createConversationSessionOptions({
      registry,
      loadLocalData: async () => ({
        ...data,
        openConversationArtifactStorage: async () => storage,
        conversationArtifactDiscovery: async () =>
          createConversationArtifactDiscovery({
            database: connection.database,
            storage,
            registry,
            data,
          }),
      }),
    });
    const [turn] = await options.restoreSession!(
      'session',
      new AbortController().signal,
    );
    const citation = turn!.citations[0]!;
    const toolAlias = registry.resolveToolReference(
      turn!.toolEvents![0]!.sources[0]!,
    )!;
    expect(registry.resolve(toolAlias)).toMatchObject({
      sourceId: record.id,
      evidenceId: record.id,
    });
    expect(registry.resolve(citation)).toMatchObject({
      sourceId: record.id,
      evidenceId: record.id,
    });
    await storage.createSession('orphan', await storage.currentGeneration());
    await storage.appendToolEvent({
      sessionId: 'orphan',
      messageId: 'unfinished',
      createdAt,
      sessionVersion: 0,
      ...captured,
    });
    await connection.database.execute(
      'DELETE FROM agent_memory_records WHERE id = ?',
      [record.id],
    );
    expect(
      (
        await connection.database.execute(
          'SELECT * FROM conversation_tool_events WHERE session_id = ?',
          ['orphan'],
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await connection.database.execute(
          'SELECT * FROM conversation_tool_lineage WHERE session_id = ?',
          ['orphan'],
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await connection.database.execute(
          'SELECT * FROM conversation_tool_dependencies WHERE session_id = ?',
          ['orphan'],
        )
      ).rows,
    ).toEqual([]);
    await expect(
      storage.appendToolEvent({
        sessionId: 'orphan',
        messageId: 'unfinished',
        createdAt,
        sessionVersion: 0,
        ...captured,
      }),
    ).rejects.toThrow();
    await expect(
      storage.appendToolEvent({
        sessionId: 'orphan',
        messageId: 'unfinished',
        createdAt,
        sessionVersion: 0,
        event: {
          ...captured.event,
          status: 'started',
          sources: [],
          resultSummary: undefined,
        },
      }),
    ).rejects.toThrow();
  } finally {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
