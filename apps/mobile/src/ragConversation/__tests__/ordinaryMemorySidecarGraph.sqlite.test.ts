import { readManualHistoryEntry, runMigrations } from '@orot/storage';
import { createConversationRetentionBridge } from '../../aiFeatures/integration/conversationRetentionBridge';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { saveOrdinaryConversationMemoryNote } from '../../storage/ordinaryConversationMemoryNote';
import type { ConversationScreenProps } from '../ConversationScreenProps';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationSessions } from '../conversationSessions';
import { entryIntentSender } from '../entryIntentSender';
import { runMultiAgentWorkflow } from '@orot/agent-runtime';
import { conversationMutationExecution } from '../../aiFeatures/integration/conversationMutationExecution';
import { executionOptions } from '../../aiFeatures/integration/featureServiceExecution';
import { authoredPlanModel } from '../../aiFeatures/integration/testSupport/syntheticAuthoredPlan';
import { ragConversationTask } from '../task';
import {
  testOrdinaryMemoryOwner,
  ordinaryMemoryPlanFixture,
  ordinaryMemoryEnrollmentFixture,
  seedOrdinaryMemoryDraft,
} from '../testSupport/ordinaryMemoryPlanFixture';

const preference = 'For future replies, I prefer concise answers.';
const at = '2026-11-26T00:00:00.000Z';

const modes = [
  'nominated',
  'omitted',
  'invalid ordinal',
  'retired',
  'opted out',
  'revoked before commit',
] as const;
const routes = ['ordinary', 'possibilities'] as const;

test.each(routes.flatMap(route => modes.map(mode => ({ route, mode }))))(
  'the stock graph and retained SQLite note honor $route nomination: $mode',
  async ({ route, mode }) => {
    const f = openSqliteTestDatabase(':memory:');
    let sessions: ReturnType<typeof createConversationSessions> | undefined;
    let committed: Promise<boolean> | undefined;
    let release = () => {};
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    try {
      await runMigrations(f.database);
      const storage = createConversationArtifactStorage(f.database);
      const sessionId = 'composed-quick-choice';
      const tool = 'save-ordinary-conversation-memory';
      const output = 'I’ll keep my replies concise.';
      const { provider, requests } = ordinaryMemoryPlanFixture(
        tool,
        output,
        mode,
      );
      const model = { providerId: provider.id, modelId: authoredPlanModel };
      const owner = testOrdinaryMemoryOwner();
      const lease = await storage.continuousSession(
        model,
        sessionId,
        at,
        new AbortController().signal,
      );
      let id = 0;
      const retention = createConversationSessionRetention({
        openStorage: async () => storage,
        createId: () => `turn-${++id}`,
        now: () => at,
      });
      const { enrollment, receipt, capture } =
        await ordinaryMemoryEnrollmentFixture(f.database, mode);
      const save = jest.fn(saveOrdinaryConversationMemoryNote);
      const store = createConversationSessions({
        continuousSession: async () => ({ ...lease, model }),
        execution: owner.execution,
        captureTemplateSelection: input => ({
          current: () => true,
          recheckOwner: signal =>
            storage.validateWarmLease(model, lease, signal, input.requestId),
        }),
        retention,
        restoreSession: async () => [],
        restoreSessionPage: async () => ({
          turns: [],
          taskCards: [],
          nextCursor: null,
        }),
        ordinaryMemory: {
          capture,
          save(captured, source, current) {
            committed = held.then(() => save(captured, source, true, current));
            return committed;
          },
        },
      });
      sessions = store;
      let sendError: unknown;
      const sender: ConversationScreenProps['onSend'] = async (
        question,
        _history,
        signal,
        observer,
        entryContext,
      ) => {
        if (!signal || !observer)
          throw new Error('Expected a real retained composer owner.');
        expect(entryContext?.intent ?? 'ordinary').toBe(route);
        const registry = new LocalEvidenceReferenceRegistry();
        type Mutation = Parameters<typeof conversationMutationExecution>[0];
        const selected = {
          status: 'ready',
          selection: model,
          provider,
          modelId: model.modelId,
          remoteProcessing: true,
          recipient: 'only-synthetic',
        } as Mutation['selected'];
        const baseExecution = executionOptions({
          selected,
          operationRunId: 'synthetic-nomination-run',
          registry,
          consent: { authorize: async () => 'authorized' as const },
          consentPurpose: 'record_conversation',
          tools: [],
        });
        const mutation = conversationMutationExecution({
          baseExecution,
          photo: undefined,
          photoEvidence: undefined,
          selected,
          registry,
          data: {} as Mutation['data'],
          question,
          observer,
          remoteMemory: entryContext ?? true,
          history: {
            messages: [],
            reports: [],
            references: [],
            sources: [],
            priorTurns: [],
            omitted: false,
            excludedQuestions: [],
          },
        });
        const beforeLocalAction = jest.fn();
        const result = await runMultiAgentWorkflow(
          {
            ...mutation.execution,
            beforeLocalAction,
            request: question,
            task: ragConversationTask,
            initialEvidence: { items: [], coverage: [], conflicts: [] },
          },
          { signal },
        );
        expect(beforeLocalAction).not.toHaveBeenCalled();
        if (result.status !== 'result')
          throw new Error(
            JSON.stringify({ result, requests: requests.length }),
          );
        expect(result.checkpoint.committedAction).not.toBe(true);
        expect(committed).toBeUndefined();
        expect(requests[0]?.tools?.map(entry => entry.name)).toContain(tool);
        if (mode !== 'omitted')
          expect(requests[1]?.messages).toContainEqual(
            expect.objectContaining({
              type: 'function_call_output',
              callID: 'nomination',
              output: JSON.stringify({
                status:
                  mode === 'invalid ordinal' || mode === 'opted out'
                    ? 'ignored'
                    : 'staged',
              }),
            }),
          );
        if (mode === 'retired') owner.retire();
        const bridge = createConversationRetentionBridge({
          question,
          registry,
          observer,
          entryContext,
          ...model,
          signal,
        });
        bridge.onValidatedEvidence([]);
        return (
          await bridge.finish({
            status: 'answer',
            answer: result.value.answer,
            citations: [],
            // A legacy metadata hint cannot substitute for the optional call.
            proactiveMemory: true,
          })
        ).outcome;
      };
      store.setRootConversationVisible(true);
      await store.synchronizeModel();
      const activeId = store.getSnapshot().activeId;
      seedOrdinaryMemoryDraft(store, activeId, preference, route);
      await store.send(
        activeId,
        entryIntentSender(
          store,
          activeId,
          async (...args) => {
            try {
              return await sender(...args);
            } catch (error) {
              sendError = error;
              throw error;
            }
          },
          'composer',
        ),
      );
      if (sendError) throw sendError;
      const first = (await storage.listCompletionIdentities())[0];
      expect(first?.messageId).toBeDefined();
      expect(capture).toHaveBeenCalledTimes(1);
      const visible = store
        .getSnapshot()
        .sessions.find(record => record.id === activeId);
      expect(visible?.messages.at(-1)?.content).toBe(output);
      if (mode === 'revoked before commit')
        await enrollment.replace(receipt, null, () => true);
      release();
      if (mode === 'nominated' || mode === 'revoked before commit') {
        expect(committed).toBeDefined();
        expect(await committed).toBe(mode === 'nominated');
      } else expect(committed).toBeUndefined();
      const note = await readManualHistoryEntry(
        f.database,
        'conversation-local-memory:auto:' + first?.messageId,
      );
      expect(note?.details).toBe(mode === 'nominated' ? preference : undefined);
      if (mode === 'nominated')
        expect(note?.effectiveDate).toEqual({ status: 'unknown' });
      store.dispose();
      expect(owner.listenerCount()).toBe(0);
    } finally {
      release();
      await committed?.catch(() => undefined);
      sessions?.dispose();
      f.close();
    }
  },
);
