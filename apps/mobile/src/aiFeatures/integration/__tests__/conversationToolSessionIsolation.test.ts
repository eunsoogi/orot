import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createResearchArtifactStorage } from '../../../storage/researchArtifactStorage';
import { createResearchArtifactDiscovery } from '../researchArtifactDiscovery';
import { createConversationSessionOptions } from '../conversationSessionOptions';
import { createResearchInputTracker } from '../researchInputTracker';
import { restoreConversationToolTurns } from '../restoreConversationToolTurns';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';

test('identical calls in different sessions keep their source across replay, reopen and deletion', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'orot-source-isolation-'));
  const path = join(dir, 'data.sqlite');
  let db = openSqliteTestDatabase(path);
  try {
    await runMigrations(db.database);
    let storage = createConversationArtifactStorage(db.database);
    let research = createResearchArtifactStorage(db.database);
    const registry = new LocalEvidenceReferenceRegistry();
    const at = '2026-11-06T00:00:00.000Z';
    const source = {
      sourceKind: 'external_medical' as const,
      sourceId: 'public-web',
      sourceRevision: `retrieved:${at}`,
      evidenceId: 'web-result-1',
      evidenceRevision: `snapshot:${at}:1`,
    };
    const event = {
      version: 1 as const,
      operationRunId: 'same-run',
      callId: 'same-call',
      toolName: 'public',
      order: 1,
      status: 'completed' as const,
      inputSummary: { sourceKind: 'external_medical' as const },
      sources: [source],
    };
    const data = {
      ...localData([]).data,
      openConversationArtifactStorage: async () => storage,
      researchArtifactDiscovery: async () =>
        createResearchArtifactDiscovery(research),
    };
    const retention = createConversationSessionOptions({
      registry,
      loadLocalData: async () => data,
    }).retention!;
    const signal = new AbortController().signal;
    const turns = [];
    for (const [index, sessionId] of ['first', 'second'].entries()) {
      await storage.createSession(sessionId, await storage.currentGeneration());
      const [id] = await research.append(
        [
          {
            createdAt: at,
            originFeature: 'record_conversation',
            originSession: sessionId,
            providerId: 'provider',
            modelId: 'model',
            generatedText: 'SECRET_OUTPUT',
            inputSources: [],
            source: {
              kind: 'public_web_search',
              status: 'historical_snapshot',
              retrievedAt: at,
              sources: [
                { title: 'Public', url: `https://example.org/${index}` },
              ],
            },
          },
        ],
        await research.currentGeneration(),
        undefined,
        { id: sessionId, version: 0 },
      );
      const tracker = createResearchInputTracker(registry, data, sessionId);
      await tracker.recordResearch([id!], signal, [source], event);
      await retention.attachExisting(index + 1, sessionId, 0);
      const turn = await retention.beginTurn(index + 1, signal);
      turns.push(turn);
      await turn.recordToolEvent(event);
      expect(
        await registry.resolveToolSource(source, signal, {
          ...event,
          sessionId,
        }),
      ).toMatchObject({
        locator: { sources: [{ url: `https://example.org/${index}` }] },
      });
    }
    const changed = { ...source, evidenceId: 'other-source' };
    await turns[0]!.recordToolEvent({ ...event, sources: [changed] });
    expect(
      await registry.resolveToolSource(changed, signal, {
        ...event,
        sessionId: 'first',
      }),
    ).toBeUndefined();
    expect(
      await registry.resolveToolSource(source, signal, {
        ...event,
        sessionId: 'first',
      }),
    ).toMatchObject({
      locator: { sources: [{ url: 'https://example.org/0' }] },
    });
    const rows = await db.database.execute(
      'SELECT event_json, sources_json FROM conversation_tool_events JOIN conversation_tool_lineage USING (session_id, run_id, call_id)',
    );
    expect(JSON.stringify(rows)).not.toMatch(/SECRET_OUTPUT|example\.org/);
    db.close();
    db = openSqliteTestDatabase(path);
    storage = createConversationArtifactStorage(db.database);
    research = createResearchArtifactStorage(db.database);
    const fresh = new LocalEvidenceReferenceRegistry();
    const reopened = [];
    for (const [index, sessionId] of ['first', 'second'].entries()) {
      const saved = await storage.readToolTurns(sessionId);
      const restored = await restoreConversationToolTurns(
        saved,
        fresh,
        data,
        signal,
        sessionId,
        storage,
      );
      const ref = restored[0]!.toolEvents[0]!.sources[0]!;
      reopened.push(ref);
      expect(
        await fresh.resolveToolSource(ref, signal, { ...event, sessionId }),
      ).toMatchObject({
        locator: { sources: [{ url: `https://example.org/${index}` }] },
      });
    }
    await storage.discardToolEvent({
      sessionId: 'first',
      messageId: turns[0]!.toolMessageId,
      sessionVersion: 0,
      operationRunId: event.operationRunId,
      callId: event.callId,
    });
    expect(
      await fresh.resolveToolSource(reopened[0]!, signal, {
        ...event,
        sessionId: 'first',
      }),
    ).toBeUndefined();
    expect(
      await fresh.resolveToolSource(reopened[1]!, signal, {
        ...event,
        sessionId: 'second',
      }),
    ).toMatchObject({
      locator: { sources: [{ url: 'https://example.org/1' }] },
    });
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
