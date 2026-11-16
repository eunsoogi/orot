import { regenerateVisitQuestions } from '../../../ragConversation/conversationVisitRegenerate';
import { createInlineVisitReview } from '../../../nextVisitQuestions/inlineVisitReview';
import type { ConversationSender } from '../../../ragConversation/conversationSessionTypes';
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

test('regenerate button retains a distinct second tool turn with the same live registry', async () => {
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
    const source = createVisitQuestionSourceService(registry, loadData);
    let workflowResult: unknown;
    sessions.setDraft(1, '진료 질문');
    const sender: ConversationSender = async (
      _question,
      _history,
      signal,
      observer,
    ) => {
      if (!signal) throw new Error('The live request must provide a signal.');
      const { provider } = makeProvider(
        successfulOutputs(prepared.initialEvidence, citation),
      );
      const { selection, option } = selectedOption(provider);

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
      // This fixture owns only tool lineage; save a minimal synthetic answer so
      // the display-only visit card does not invoke an unrelated retention fallback.
      if (result.status === 'ready')
        await observer?.onRetentionCandidate?.(
          {
            question: _question,
            answer: '준비했어요.',
            providerId: provider.id,
            modelId: selection.modelId,
            sources: [],
            citations: [],
          },
          signal,
        );
      return result.status === 'ready'
        ? {
            status: 'answer',
            answer: '준비했어요.',
            citations: [],
            visitQuestions: {
              appointment: initial.appointment,
              review: createInlineVisitReview(
                'synthetic',
                [],
                result.questions,
                [],
              ),
              validateSource: async () => true,
            },
          }
        : { status: 'failure', kind: 'unavailable' };
    };
    await sessions.send(1, sender);
    const sessionId = options.retention!.activeIdentity(1)!;
    const rows = await storage.readToolTurns(sessionId, 0);
    expect(workflowResult).toMatchObject({ status: 'ready' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.toolEvents.map(event => event.status)).toEqual([
      'completed',
    ]);
    expect(JSON.stringify(rows)).not.toContain('최근 검사 결과');
    const before = sessions.getSnapshot().sessions[0]!;
    const message = before.messages.find(value => value.visitQuestions)!;
    const settled = new Promise<void>(resolve => {
      const unsubscribe = sessions.subscribe(() => {
        const current = sessions.getSnapshot().sessions[0]!;
        if (!current.busy && current.messages.length > before.messages.length) {
          unsubscribe();
          resolve();
        }
      });
    });
    regenerateVisitQuestions({
      store: sessions,
      sessionId: 1,
      message,
      prepare: sender,
    });
    await settled;
    const repeated = await storage.readToolTurns(sessionId, 0);
    expect(repeated).toHaveLength(2);
    expect(new Set(repeated.map(turn => turn.messageId)).size).toBe(2);
    expect(sessions.getSnapshot().sessions[0]!.error).toBe('');
    expect(
      repeated.every(turn => turn.toolEvents[0]?.status === 'completed'),
    ).toBe(true);
    sessions.dispose();
  } finally {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
