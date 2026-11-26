import { createManualHistoryRepository } from '@orot/storage';
import type { SelectedAiResolution } from '../provider';
import type { runRagConversationTurn } from '../../../ragConversation/service';
import type { ConversationSessions } from '../../../ragConversation/conversationSessions';
import { entryIntentSender } from '../../../ragConversation/entryIntentSender';
import { setConversationEntryForSession } from '../../../ragConversation/useConversationEntryIntent';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { saveConversationHealthHistory } from '../../../storage/conversationHealthHistory';
import { confirmAuthoredMemoryTerminal } from '../../../storage/conversationAuthoredMemoryTerminal';
import { createRagConversationService } from '../ragConversationService';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { apple, localData } from '../featureServiceFixtures';
import { healthContextFixture } from '../testSupport/healthContextPersistenceFixture';

const statement = 'The Lilac project demo is every Friday.';
const question = `${statement} I would like you to keep that in mind.`;
const providerId = 'chatgpt-plan:synthetic';
const modelId = 'synthetic-model';
const previousAnswerTool = 'remember-conversation-answer';

/** Exercise the canonical shortcut sender, production tool assembly and SQLite write. */
test.each(['ordinary', 'after-health-summary'] as const)(
  'typed explicit authored detail is saved in the canonical %s Conversation',
  async mode => {
    const f = await healthContextFixture();
    try {
      const storage = createConversationArtifactStorage(f.database);
      const sessionId = 'synthetic-session';
      const requestId = 'synthetic-request';
      await storage.createSession(sessionId, await storage.currentGeneration());
      await storage.startRequest({
        id: requestId,
        sessionId,
        sessionVersion: 0,
        question,
        createdAt: '2026-11-25T00:00:00.000Z',
      });
      const store = {
        getSnapshot: () => ({ sessions: [{ id: 1 }] }),
        setEntryPrompt: jest.fn(),
      } as unknown as ConversationSessions;
      if (mode === 'after-health-summary') {
        setConversationEntryForSession(store, 1, {
          intent: 'health-summary',
          entryKey: 'synthetic-summary-shortcut',
        });
        await entryIntentSender(
          store,
          1,
          async (_q, _h, _s, observer, entry) => {
            expect(observer?.inputOrigin).toBe('shortcut');
            expect(entry?.intent).toBe('health-summary');
            return {
              status: 'answer',
              answer: 'Synthetic report',
              citations: [],
            };
          },
        )('Synthetic shortcut label', []);
      }
      const generate = jest.fn();
      const provider = {
        ...apple.provider,
        id: providerId,
        capabilities: { ...apple.provider.capabilities, toolCalling: true },
        generate,
      };
      const selection = {
        status: 'ready',
        selection: { providerId, modelId },
        option: apple,
        provider,
        modelId,
        recipient: 'Synthetic selected recipient',
        remoteProcessing: true,
      } as Extract<SelectedAiResolution, { status: 'ready' }>;
      const offered: string[] = [];
      const runner: typeof runRagConversationTurn = async options => {
        const actions = options.workflow.actions ?? [];
        offered.push(...actions.map(tool => tool.id));
        expect(
          actions.find(tool => tool.id === previousAnswerTool),
        ).toBeUndefined();
        const action = actions.find(
          tool => tool.id === 'remember-current-user-statement',
        );
        if (!action) throw new Error('The authored local tool is absent.');
        const signal = new AbortController().signal;
        const operation = {
          operationRunId: options.workflow.execution.operationRunId,
          operationKey: 'tool-1',
        };
        const input = { statement };
        expect(action.completion).toBe('host_terminal');
        expect(await action.authorize(input, signal, operation)).toBe(true);
        expect(await action.execute({ input, signal, ...operation })).toEqual({
          items: [],
          coverage: [],
          conflicts: [],
        });
        expect(
          await options.workflow.confirmTerminalLocalAction?.({
            input,
            toolId: action.id,
            toolVersion: action.version,
            signal,
            ...operation,
          }),
        ).toBeDefined();
        return {
          status: 'answer',
          answer: 'Untrusted model receipt',
          citations: [],
        };
      };
      const authorize = jest.fn(async () => 'authorized' as const);
      const confirmHistorySave = jest.fn(async () => true);
      const externalSearch = jest.fn();
      const send = createRagConversationService({
        selectedAi: async () => selection,
        consent: { authorize },
        queryConsent: { authorize },
        externalEvidence: { search: externalSearch },
        registry: new LocalEvidenceReferenceRegistry(),
        loadLocalData: async () => ({
          ...localData([]).data,
          saveConversationHistory: (input, signal) =>
            saveConversationHealthHistory(f.database, input, signal),
          confirmAuthoredMemoryTerminal: (input, signal) =>
            confirmAuthoredMemoryTerminal(f.database, input, signal),
        }),
        ragRunner: runner,
      });
      const result = await entryIntentSender(
        store,
        1,
        (_q, _h, _s, observer, entry) => {
          expect(observer?.inputOrigin).toBe('composer');
          expect(entry).toEqual(
            mode === 'ordinary'
              ? undefined
              : {
                  intent: 'conversation',
                  entryKey: 'synthetic-summary-shortcut',
                },
          );
          return send(_q, _h, _s, observer, entry);
        },
        'composer',
      )(question, [], new AbortController().signal, {
        expectedConversationModel: {
          providerId,
          modelId,
          isCurrent: () => true,
        },
        templateProposalOwner: {
          providerId,
          modelId,
          current: () => true,
          recheck: async () => true,
          watch: () => () => {},
        },
        retentionSession: { id: sessionId, version: 0 },
        retentionRequestId: requestId,
        confirmHistorySave,
        suppressContextualOpening: true,
      });
      expect(offered).toContain('remember-current-user-statement');
      expect(result).toMatchObject({
        status: 'answer',
        committedAnswerMemory: true,
      });
      expect(confirmHistorySave).toHaveBeenCalledWith(
        statement,
        expect.anything(),
      );
      expect(
        (await createManualHistoryRepository(f.database).list()).map(
          note => note.details,
        ),
      ).toEqual([statement]);
      expect(externalSearch).not.toHaveBeenCalled();
      expect(generate).not.toHaveBeenCalled();
    } finally {
      f.close();
    }
  },
);
