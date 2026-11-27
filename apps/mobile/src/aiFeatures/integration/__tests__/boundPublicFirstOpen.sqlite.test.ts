import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createResearchArtifactStorage } from '../../../storage/researchArtifactStorage';
import { bindLiveConversationToolSources } from '../bindLiveConversationToolSources';
import { createResearchArtifactDiscovery } from '../researchArtifactDiscovery';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';

function gate() {
  let release = () => {};
  const promise = new Promise<void>(resolve => {
    release = resolve;
  });
  return { release, promise };
}

async function fixture() {
  const db = openSqliteTestDatabase(':memory:');
  await runMigrations(db.database);
  const storage = createConversationArtifactStorage(db.database);
  const research = createResearchArtifactStorage(db.database);
  const sessionId = 'synthetic-session';
  const createdAt = '2026-11-27T00:00:00.000Z';
  const operationRunId = 'synthetic-run';
  const callId = 'synthetic-web';
  await storage.createSession(sessionId, await storage.currentGeneration());
  await research.append(
    [
      {
        createdAt,
        originFeature: 'record_conversation',
        providerId: 'synthetic',
        modelId: 'synthetic',
        source: {
          kind: 'public_web_search',
          status: 'historical_snapshot',
          retrievedAt: createdAt,
          sources: [
            {
              title: 'Synthetic web source',
              url: 'https://example.org/synthetic',
            },
          ],
        },
        generatedText: 'Synthetic retained explanation',
      },
    ],
    await research.currentGeneration(),
  );
  const registry = new LocalEvidenceReferenceRegistry();
  const discovery = createResearchArtifactDiscovery(research);
  const artifact = (await discovery.read('research-1'))!;
  const source = artifact.sources[0]!;
  const revision = artifact.metadata.revision;
  const reference = {
    ...source,
    sourceKind: 'generated_artifact' as const,
    sourceId: artifact.metadata.id,
    evidenceId: artifact.metadata.id,
    sourceRevision: revision,
    evidenceRevision: revision,
    effectiveTime: null,
    locator: { kind: 'generated_artifact', type: 'research_web_explanation' },
  };
  const event = {
    version: 1 as const,
    operationRunId,
    callId,
    toolName: 'public-web-search',
    order: 1,
    status: 'completed' as const,
    inputSummary: { sourceKind: 'external_medical' as const },
    sources: [source],
  };
  await storage.appendToolEvent({
    sessionId,
    sessionVersion: 0,
    messageId: 'synthetic-turn',
    createdAt,
    event,
    dependencies: [
      {
        kind: 'external_research',
        reference: source,
        research: {
          kind: 'generated_research',
          id: artifact.metadata.id,
          revision,
          reference,
        },
      },
    ],
  });
  const read = jest.spyOn(discovery, 'read');
  await bindLiveConversationToolSources(
    event,
    sessionId,
    storage,
    {
      ...localData([]).data,
      researchArtifactDiscovery: async () => discovery,
    },
    registry,
  );
  read.mockClear();
  const toolCallProof = jest.fn();
  const transaction = db.database.transaction.bind(db.database);
  db.database.transaction = operation =>
    transaction(tx =>
      operation({
        ...tx,
        execute: async (...args) => {
          if (
            args[0].includes(
              'FROM conversation_tool_events e JOIN conversation_artifact_sessions',
            )
          )
            toolCallProof();
          return tx.execute(...args);
        },
      }),
    );
  const scope = { sessionId, operationRunId, callId };
  const open = (signal = new AbortController().signal) =>
    registry.resolveToolSource(source, signal, scope);
  return {
    db,
    read,
    open,
    registry,
    source,
    scope,
    toolCallProof,
    storage,
    createdAt,
  };
}

test('saved public source uses one complete bound proof after an independent writer without search', async () => {
  const f = await fixture();
  const entered = gate();
  const writeAllowed = gate();
  try {
    const transaction = f.db.database.transaction.bind(f.db.database);
    f.db.database.transaction = operation =>
      transaction(tx =>
        operation({
          ...tx,
          execute: async (...args) => {
            const result = await tx.execute(...args);
            if (
              args[0].startsWith('INSERT INTO conversation_tool_events ') &&
              args[1]?.includes('synthetic-personal-search')
            ) {
              entered.release();
              await writeAllowed.promise;
            }
            return result;
          },
        }),
      );
    const writer = f.storage.appendToolEvent({
      sessionId: f.scope.sessionId,
      sessionVersion: 0,
      messageId: 'synthetic-turn',
      createdAt: f.createdAt,
      event: {
        version: 1,
        operationRunId: f.scope.operationRunId,
        callId: 'synthetic-personal-search',
        toolName: 'personal-record-search',
        order: 2,
        status: 'completed',
        inputSummary: { sourceKind: 'personal_record' },
        sources: [],
      },
    });
    await entered.promise;
    const pending = f.open();
    expect(f.read).not.toHaveBeenCalled();
    expect(f.toolCallProof).not.toHaveBeenCalled();
    writeAllowed.release();
    await writer;
    await expect(pending).resolves.toEqual(f.source);
    expect(f.toolCallProof).toHaveBeenCalledTimes(2);
    expect(f.read).toHaveBeenCalledTimes(4);
    await expect(
      f.registry.resolveToolSource(f.source, new AbortController().signal, {
        ...f.scope,
        callId: 'foreign',
      }),
    ).resolves.toBeUndefined();
    expect(f.toolCallProof).toHaveBeenCalledTimes(2);
    await expect(f.open()).resolves.toEqual(f.source);
    expect(f.toolCallProof).toHaveBeenCalledTimes(4);
    expect(f.read).toHaveBeenCalledTimes(8);
  } finally {
    writeAllowed.release();
    f.db.close();
  }
});

test.each(['deleted', 'changed', 'aborted'] as const)(
  'bound public source withholds when retained read is %s',
  async mode => {
    const f = await fixture();
    const readEntered = gate();
    const readAllowed = gate();
    try {
      const original = f.read.getMockImplementation()!;
      f.read.mockImplementationOnce(async (...args) => {
        readEntered.release();
        await readAllowed.promise;
        return original(...args);
      });
      const controller = new AbortController();
      const pending = f.open(controller.signal);
      await readEntered.promise;
      if (mode === 'deleted')
        await f.db.database.execute(
          'DELETE FROM research_artifacts WHERE id = 1',
        );
      else if (mode === 'changed')
        await f.db.database.execute(
          "UPDATE research_artifacts SET snapshot_json=json_set(snapshot_json,'$.generatedText','Different synthetic snapshot') WHERE id=1",
        );
      else controller.abort();
      readAllowed.release();
      await expect(pending).resolves.toBeUndefined();
    } finally {
      readAllowed.release();
      f.db.close();
    }
  },
);
