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
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { createResearchArtifactDiscovery } from '../researchArtifactDiscovery';
import { createConversationSessionOptions } from '../conversationSessionOptions';
import { createResearchInputTracker } from '../researchInputTracker';
import { captureConversationToolSources } from '../captureConversationToolSources';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';

const at = '2026-11-06T00:00:00.000Z';
const externalWeb = {
  sourceKind: 'external_medical' as const,
  sourceId: 'public-web',
  sourceRevision: `retrieved:${at}`,
  evidenceId: 'web-result-1',
  evidenceRevision: `snapshot:${at}:1`,
};
const url = 'https://example.org/public';
const paperUrl = 'https://europepmc.org/article/MED/123';
const externalPaper = {
  sourceKind: 'external_medical' as const,
  sourceId: 'europe-pmc',
  sourceRevision: `retrieved:${at}`,
  evidenceId: 'MED:123',
  evidenceRevision: `retrieved:${at}`,
};

test.each([
  ['web', externalWeb, 'remove'],
  ['web', externalWeb, 'change'],
  ['paper', externalPaper, 'remove'],
  ['paper', externalPaper, 'change'],
  ['web', externalWeb, 'call'],
  ['paper', externalPaper, 'session'],
] as const)(
  'reopened %s source stops after %s',
  async (kind, external, action) => {
    const directory = mkdtempSync(join(tmpdir(), 'orot-tool-external-'));
    const path = join(directory, 'data.sqlite');
    let connection = openSqliteTestDatabase(path);
    try {
      await runMigrations(connection.database);
      let storage = createConversationArtifactStorage(connection.database);
      let research = createResearchArtifactStorage(connection.database);
      await storage.createSession('session', await storage.currentGeneration());
      const [id] = await research.append(
        [
          {
            createdAt: at,
            originFeature: 'record_conversation',
            originSession: 'session',
            providerId: 'provider',
            modelId: 'model',
            generatedText: kind === 'web' ? 'public output' : null,
            inputSources: [],
            source:
              kind === 'web'
                ? {
                    kind: 'public_web_search',
                    status: 'historical_snapshot',
                    retrievedAt: at,
                    sources: [{ title: 'Public', url }],
                  }
                : {
                    kind: 'publication',
                    status: 'historical_snapshot',
                    retrievedAt: at,
                    title: 'Paper',
                    url: paperUrl,
                  },
          },
        ],
        await research.currentGeneration(),
        undefined,
        { id: 'session', version: 0 },
      );
      const registry = new LocalEvidenceReferenceRegistry();
      const data = {
        ...localData([]).data,
        researchArtifactDiscovery: async () =>
          createResearchArtifactDiscovery(research),
      };
      const tracker = createResearchInputTracker(registry, data, 'session');
      await tracker.recordResearch(
        [id!],
        new AbortController().signal,
        [external],
        { operationRunId: 'run', callId: 'call' },
      );
      const event = {
        version: 1 as const,
        operationRunId: 'run',
        callId: 'call',
        toolName: 'public-web-search',
        order: 1,
        status: 'completed' as const,
        inputSummary: { sourceKind: 'external_medical' as const },
        sources: [external],
      };
      const captured = await captureConversationToolSources(
        event,
        registry,
        storage,
        'session',
      );
      await storage.appendToolEvent({
        sessionId: 'session',
        messageId: 'turn',
        createdAt: at,
        sessionVersion: 0,
        ...captured,
        dependencies: captured.dependencies.map(dependency => ({
          ...dependency,
          extra: 'SECRET_INPUT',
          reference: { ...dependency.reference, hidden: 'SECRET_REASONING' },
        })) as unknown as typeof captured.dependencies,
      });
      const rows = await connection.database.execute(
        'SELECT event_json, sources_json FROM conversation_tool_events JOIN conversation_tool_lineage USING (session_id, run_id, call_id)',
      );
      expect(JSON.stringify(rows)).not.toContain(
        kind === 'web' ? url : paperUrl,
      );
      expect(JSON.stringify(rows)).not.toMatch(/SECRET_/);
      connection.close();
      connection = openSqliteTestDatabase(path);
      storage = createConversationArtifactStorage(connection.database);
      research = createResearchArtifactStorage(connection.database);
      const fresh = new LocalEvidenceReferenceRegistry();
      const current = {
        ...data,
        openConversationArtifactStorage: async () => storage,
        conversationArtifactDiscovery: async () =>
          createConversationArtifactDiscovery({
            database: connection.database,
            storage,
            data,
            registry: fresh,
          }),
        researchArtifactDiscovery: async () =>
          createResearchArtifactDiscovery(research),
      };
      const options = createConversationSessionOptions({
        registry: fresh,
        loadLocalData: async () => current,
      });
      const [turn] = await options.restoreSession!(
        'session',
        new AbortController().signal,
      );
      const source = turn!.toolEvents![0]!.sources[0]!;
      expect(
        await fresh.resolveToolSource(source, new AbortController().signal, {
          operationRunId: 'run',
          callId: 'call',
          sessionId: 'session',
        }),
      ).toMatchObject(
        kind === 'web'
          ? {
              sourceKind: 'external_medical',
              sourceId: 'public-web',
              locator: { sources: [{ url }] },
            }
          : {
              sourceKind: 'external_medical',
              sourceId: 'europe-pmc',
              locator: { originalUrl: paperUrl },
            },
      );
      if (action === 'remove') await research.remove(id!);
      else if (action === 'call')
        await storage.discardToolEvent({
          sessionId: 'session',
          messageId: 'turn',
          sessionVersion: 0,
          operationRunId: 'run',
          callId: 'call',
        });
      else if (action === 'session') await storage.hideSession('session', 0);
      else
        await connection.database.execute(
          "UPDATE research_artifacts SET snapshot_json = json_set(snapshot_json, ?, 'Changed') WHERE id = ?",
          [
            kind === 'web' ? '$.source.sources[0].title' : '$.source.title',
            id!,
          ],
        );
      expect(
        await fresh.resolveToolSource(source, new AbortController().signal, {
          operationRunId: 'run',
          callId: 'call',
          sessionId: 'session',
        }),
      ).toBeUndefined();
    } finally {
      connection.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
