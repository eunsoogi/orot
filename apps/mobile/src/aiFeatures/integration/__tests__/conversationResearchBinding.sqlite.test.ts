import { runMigrations } from '@orot/storage';
import type { ConversationToolEvent } from '@orot/agent-runtime';
import { NativeModules } from 'react-native';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createResearchArtifactStorage } from '../../../storage/researchArtifactStorage';
import { createConversationSessions } from '../../../ragConversation/conversationSessions';
import { createConversationSessionRetention } from '../../../ragConversation/conversationSessionRetention';
import { t } from '../../../i18n';
import { createResearchArtifactDiscovery } from '../researchArtifactDiscovery';
import { createResearchInputTracker } from '../researchInputTracker';
import { captureConversationToolSources } from '../captureConversationToolSources';
import { conversationStoredToolObserver } from '../conversationStoredToolObserver';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';
import {
  assertSavedAnswer,
  createResearchBindingTools,
  saveSyntheticAnswer,
  syntheticAnswer,
} from '../testSupport/conversationResearchBindingFixture';
const at = '2026-11-06T00:00:00.000Z';
const paperId = 'synthetic-paper-call';
const blocked = 'synthetic dependency reindex rejected';
const faults = [
  'terminal-write',
  'bind-read',
  'bind-read-opted-out',
  'none',
] as const;
test.each(faults)(
  'file SQLite separates write and bind failures: %s',
  verifyBindingFault,
);
async function verifyBindingFault(fault: (typeof faults)[number]) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-research-bind-'));
  const path = join(directory, 'records.sqlite');
  const connection = openSqliteTestDatabase(path);
  const originalDiagnostics = NativeModules.OrotProviderDiagnostics;
  const report = jest.fn<void, [string, string, string]>();
  NativeModules.OrotProviderDiagnostics = {
    enabled: fault !== 'bind-read-opted-out',
    report,
  };
  try {
    await runMigrations(connection.database);
    const conversations = createConversationArtifactStorage(
      connection.database,
    );
    await conversations.currentGeneration();
    const research = createResearchArtifactStorage(connection.database);
    const data = {
      ...localData([]).data,
      openResearchArtifactStorage: async () => research,
      researchArtifactDiscovery: async () =>
        createResearchArtifactDiscovery(research),
    };
    const registry = new LocalEvidenceReferenceRegistry();
    const openStorage = async () => conversations;
    const loadData = async () => data;
    let next = 0;
    const sessions = createConversationSessions({
      retention: createConversationSessionRetention({
        openStorage,
        createId: () => `synthetic-${++next}`,
        now: () => at,
        captureToolSources: (event, sessionId) =>
          captureConversationToolSources(
            event,
            registry,
            conversations,
            sessionId,
          ),
        onToolEventStored: conversationStoredToolObserver(
          openStorage,
          loadData,
          registry,
        ),
      }),
    });
    const run = publicEvidenceFixture();
    const tracker = createResearchInputTracker(registry, data, 'synthetic-1');
    const { selected, literatureSearch } = createResearchBindingTools(
      run,
      loadData,
      tracker.recordResearch,
      at,
    );
    const web = selected.tools.find(item => item.id === 'public-web-search')!;
    const literature = selected.tools.find(
      item => item.id !== 'public-web-search',
    )!;
    // The terminal lineage write takes place only after its event update. For
    // the bind variant, the first dependency insert commits; only a later
    // reindex of that same dependency from the strict read can hit the trigger.
    if (fault === 'terminal-write')
      await connection.database.execute(`
        CREATE TRIGGER fail_synthetic_tool_terminal BEFORE INSERT ON conversation_tool_lineage
        WHEN NEW.call_id = '${paperId}' AND NEW.sources_json <> '[]'
        BEGIN SELECT RAISE(ABORT, '${blocked}'); END
      `);
    else if (fault.startsWith('bind-read'))
      await connection.database.execute(`
        CREATE TRIGGER fail_synthetic_tool_bind BEFORE INSERT ON conversation_tool_dependencies
        WHEN NEW.call_id = '${paperId}' AND EXISTS (
          SELECT 1 FROM conversation_tool_dependencies WHERE call_id = NEW.call_id
        )
        BEGIN SELECT RAISE(ABORT, '${blocked}'); END
      `);
    const tools = [
      [web, run.request.operationKey],
      [literature, paperId],
    ] as const;
    const completed: ConversationToolEvent[] = [];
    try {
      sessions.setDraft(1, 'Synthetic question');
      await sessions.send(1, async (question, _history, signal, observer) => {
        for (const [order, [tool, callId]] of tools.entries()) {
          const started: ConversationToolEvent = {
            version: 1,
            operationRunId: run.request.operationRunId,
            callId,
            toolName: 'search',
            order,
            status: 'started',
            inputSummary: { sourceKind: 'external_medical' },
            sources: [],
          };
          observer!.onToolEvent!(started);
          const result = await tool.search({
            ...run.request,
            operationKey: callId,
          });
          if ('status' in result) throw new Error('Synthetic search failed');
          const event: ConversationToolEvent = {
            ...started,
            status: 'completed',
            sources: result.items,
          };
          completed.push(event);
          observer!.onToolEvent!(event);
        }
        await saveSyntheticAnswer(observer!, question, signal);
        return { status: 'answer', answer: syntheticAnswer, citations: [] };
      });
      await assertSavedAnswer(connection.database);
      expect(run.search).toHaveBeenCalledTimes(1);
      expect(literatureSearch).toHaveBeenCalledTimes(1);
      const session = sessions.getSnapshot().sessions[0]!;
      expect(session.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ content: syntheticAnswer }),
        ]),
      );
      const warning = t('ragConversation.conversation.toolActivitySaveFailed');
      if (fault === 'none') expect(session.error).not.toBe(warning);
      else expect(session.error).toBe(warning);
      const durable = await connection.database.execute(
        'SELECT e.call_id, e.event_json, l.sources_json FROM conversation_tool_events e LEFT JOIN conversation_tool_lineage l USING (session_id, run_id, call_id)',
      );
      expect(durable.rows).toHaveLength(2);
      for (const [index, event] of completed.entries()) {
        const terminal = index === 0 || fault !== 'terminal-write';
        const row = durable.rows.find(item => item.call_id === event.callId);
        expect(JSON.parse(String(row?.event_json)).status).toBe(
          terminal ? 'completed' : 'started',
        );
        const sources = row?.sources_json;
        expect(sources && JSON.parse(String(sources)).length).toBe(
          terminal ? event.sources.length : null,
        );
        const available = await registry.resolveToolSource(
          event.sources[0]!,
          run.controller.signal,
          {
            ...event,
            sessionId: 'synthetic-1',
          },
        );
        if (index === 0 || fault === 'none') expect(available).toBeDefined();
        else expect(available).toBeUndefined();
      }
      if (fault === 'terminal-write') {
        expect(report.mock.calls).toContainEqual([
          'storage',
          'tool_event_write',
          'failed',
        ]);
        expect(report.mock.calls).not.toContainEqual([
          'storage',
          'tool_event_bind_owner',
          'failed',
        ]);
      } else if (fault.startsWith('bind-read')) {
        expect(report.mock.calls).toContainEqual([
          'storage',
          'tool_event_bind',
          'failed',
        ]);
        expect(report.mock.calls).not.toContainEqual([
          'storage',
          'tool_event_write',
          'failed',
        ]);
        const binding = report.mock.calls.filter(([, phase]) =>
          ['tool_event_bind_owner', 'tool_event_bind_restore'].includes(phase),
        );
        expect(binding).toEqual(
          fault === 'bind-read-opted-out'
            ? []
            : [
                ['storage', 'tool_event_bind_owner', 'completed'],
                ['storage', 'tool_event_bind_restore', 'completed'],
                ['storage', 'tool_event_bind_owner', 'failed'],
              ],
        );
        expect(JSON.stringify(report.mock.calls)).not.toMatch(
          /synthetic|example\.org|europepmc/u,
        );
        await connection.database.execute(
          'DROP TRIGGER fail_synthetic_tool_bind',
        );
        // A settled read fault is not a deletion or a failed append. The
        // ordinary strict reader can get both completed rows without replay.
        expect(
          (await conversations.readToolTurns('synthetic-1'))[0]?.toolEvents,
        ).toEqual(
          expect.arrayContaining(
            completed.map(({ callId }) =>
              expect.objectContaining({ callId, status: 'completed' }),
            ),
          ),
        );
      }
    } finally {
      sessions.dispose();
    }
  } finally {
    NativeModules.OrotProviderDiagnostics = originalDiagnostics;
    connection.close();
    rmSync(directory, { force: true, recursive: true });
  }
}
