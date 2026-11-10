import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import {
  citation,
  evidenceSpan,
  sourceRecord,
} from '../../../agent/visitQuestions/testing/persistenceFixtures';
import {
  makeProvider,
  preparedContext,
  selectedOption,
  successfulOutputs,
} from '../../../agent/visitQuestions/testing/workflowFixtures';
import { runVisitQuestionWorkflow } from '../../../agent/visitQuestions/workflow';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createConversationSessions } from '../../../ragConversation/conversationSessions';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { createConversationSessionOptions } from '../conversationSessionOptions';
import { createVisitQuestionSourceService } from '../visitQuestionSourceRegistration';
import { createConversationVisitToolSource } from '../conversationVisitToolSource';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';

test('real visit runtime events retain SQLite source lineage and reopen in the same call', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-visit-tool-'));
  const path = join(directory, 'records.sqlite');
  let connection = openSqliteTestDatabase(path);
  try {
    await runMigrations(connection.database);
    let records = createRecordRepository(connection.database);
    await records.put('source_record', sourceRecord as never);
    await records.put('evidence_span', evidenceSpan as never);
    let storage = createConversationArtifactStorage(connection.database);
    const registry = new LocalEvidenceReferenceRegistry();
    const base = localData([]).data;
    const repository = {
      readRecord: async (kind: Parameters<typeof records.get>[0], id: string) =>
        records.get(kind, id),
      querySource: async () => ({
        status: 'available',
        complete: true,
        records: [
          { kind: 'source_record', record: sourceRecord },
          { kind: 'evidence_span', record: evidenceSpan },
        ],
      }),
    } as never;
    const data = { ...base, repository };
    const loadData = async () => ({
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
      loadLocalData: loadData,
    });
    const sessions = createConversationSessions(options);
    const initial = preparedContext();
    const originalSearch = await initial.searchEvidence(
      'synthetic',
      5,
      'personal_record',
    );
    const prepared = {
      ...initial,
      supplementalEvidence: citation,
      searchEvidence: jest.fn(async () => ({
        ...originalSearch,
        batch: { ...originalSearch.batch, items: [citation] },
      })),
    };
    const { provider } = makeProvider(
      successfulOutputs(prepared.initialEvidence, citation),
    );
    const { selection, option } = selectedOption(provider);
    const source = createVisitQuestionSourceService(registry, loadData);
    let workflowResult: unknown;
    sessions.setDraft(1, '진료 질문');
    await sessions.send(1, async (_question, _history, signal, observer) => {
      const result = await runVisitQuestionWorkflow({
        prepared,
        selection,
        providerOptions: [option],
        recipient: 'selected account',
        confirmConsent: async () => true,
        signal,
        observer,
        registerToolSource: createConversationVisitToolSource(
          registry,
          source.registerVisitQuestionSource,
        ),
      });
      workflowResult = result;
      return result.status === 'ready'
        ? { status: 'answer', answer: '준비했어요.', citations: [] }
        : { status: 'failure', kind: 'unavailable' };
    });
    const sessionId = options.retention!.activeIdentity(1)!;
    const rows = await storage.readToolTurns(sessionId, 0);
    expect(workflowResult).toMatchObject({ status: 'ready' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.toolEvents.map(event => event.status)).toEqual([
      'completed',
    ]);
    expect(JSON.stringify(rows)).not.toContain('최근 검사 결과');
    sessions.dispose();
    connection.close();
    connection = openSqliteTestDatabase(path);
    records = createRecordRepository(connection.database);
    storage = createConversationArtifactStorage(connection.database);
    const fresh = new LocalEvidenceReferenceRegistry();
    const restored = await createConversationSessionOptions({
      registry: fresh,
      loadLocalData: loadData,
    }).restoreSession!(sessionId, new AbortController().signal);
    expect(restored[0]?.toolEvents?.map(event => event.status)).toEqual([
      'completed',
    ]);
    expect(restored[0]?.toolEvents?.[0]?.sources).toHaveLength(1);
    const event = restored[0]!.toolEvents![0]!;
    const scope = {
      sessionId,
      operationRunId: event.operationRunId,
      callId: event.callId,
    };
    expect(
      await fresh.resolveToolSource(
        event.sources[0]!,
        new AbortController().signal,
        scope,
      ),
    ).toBeDefined();
    await records.put('source_record', {
      ...sourceRecord,
      recordedAt: '2026-09-02T09:00:00Z',
      ingestedAt: '2026-09-02T09:00:00Z',
    } as never);
    expect(
      await fresh.resolveToolSource(
        event.sources[0]!,
        new AbortController().signal,
        scope,
      ),
    ).toBeUndefined();
  } finally {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
