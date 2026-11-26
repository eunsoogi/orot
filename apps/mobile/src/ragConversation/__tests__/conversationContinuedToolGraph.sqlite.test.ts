import { createHealthContextTool } from '../../conversationTools/healthContextTool';
import { window } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import {
  providerSuccess,
  type LanguageModelRequest,
} from '@orot/model-runtime';
import { createConversationSessions } from '../conversationSessions';
import type { ConversationExecutionEvent } from '../conversationExecutionLease';
import type { ConversationSender } from '../conversationSessionTypes';
import { runRagConversationTurn } from '../service';
import { fixture as envelope } from '../testSupport/conversationEnvelopeFixtures';
import { setup } from '../testSupport/continuousSessionFixture';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

test.each(['admitted', 'stop', 'lock', 'expiry'] as const)(
  'one Text request can dispatch a second tool only while its admitted background lease survives: %s',
  async mode => {
    const local = await setup();
    const entered = deferred();
    const release = deferred();
    const stock = createHealthContextTool(
      local.read,
      local.registry,
      'rag',
      true,
    );
    const first = jest.fn<
      ReturnType<typeof stock.search>,
      Parameters<typeof stock.search>
    >(async (...args) => {
      entered.resolve();
      await release.promise;
      return stock.search(...args);
    });
    const second = jest.fn(async (...args: Parameters<typeof stock.search>) => {
      expect(phase).toBe('background');
      return stock.search(...args);
    });
    const firstId = 'fixture-first-read';
    const secondId = 'fixture-second-read';
    let phase: 'active' | 'background' = 'active';
    let protection = true;
    const listeners = new Set<(event: ConversationExecutionEvent) => void>();
    const emit = (event: ConversationExecutionEvent) =>
      listeners.forEach(listener => listener(event));
    const work = jest.fn<void, [string, boolean]>();
    const begin = jest.fn(async () => true);
    const store = createConversationSessions({
      ...local.options,
      execution: {
        begin,
        end: jest.fn(),
        work,
        currentPhase: () => phase,
        isActive: async () => true,
        protectedDataAvailable: async () => protection,
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      },
    });
    const { options } = envelope();
    const payloads: LanguageModelRequest[] = [];
    const generate = jest.fn(async (request: LanguageModelRequest) => {
      payloads.push(request);
      const receipts = request.messages.filter(
        message => message.role === 'tool',
      );
      if (receipts.length < 2) {
        const id = receipts.length === 0 ? firstId : secondId;
        return providerSuccess({
          text: '',
          toolCalls: [
            {
              id: 'call-' + id,
              name: id,
              arguments: {
                topics: ['measurements'],
                window:
                  receipts.length === 0
                    ? window
                    : { ...window, toExclusive: '2026-10-03T00:00:00Z' },
              },
            },
          ],
          finishReason: 'tool_calls' as const,
        });
      }
      return providerSuccess({
        text: JSON.stringify({
          type: 'result',
          value: {
            answerKind: 'grounded',
            answer: '저장된 기록을 확인했어요.',
          },
          citations: receipts.flatMap(
            receipt =>
              (receipt.result as { evidenceIds: string[] }).evidenceIds,
          ),
        }),
        toolCalls: [],
        finishReason: 'complete' as const,
      });
    });
    const sender = jest.fn<
      ReturnType<ConversationSender>,
      Parameters<ConversationSender>
    >((question, previousMessages, signal, observer) =>
      runRagConversationTurn(
        {
          ...options,
          question,
          previousMessages,
          resolveLocalEvidenceIdentity: reference =>
            local.registry.resolve(reference),
          loadCurrentEvidence: async () => ({
            batch: { items: [], coverage: [], conflicts: [] },
            chunks: [],
          }),
          workflow: {
            ...options.workflow,
            execution: {
              ...options.workflow.execution,
              providerId: 'synthetic',
              modelId: 'a',
              allowedScope: { sourceKinds: ['personal_record'] },
            },
            tools: [
              { ...stock, id: firstId, search: first },
              { ...stock, id: secondId, search: second },
            ],
            revalidateEvidence: (references, currentSignal) =>
              local.registry.revalidateEvidence(references, currentSignal),
            provider: {
              ...options.workflow.provider,
              id: 'synthetic',
              capabilities: {
                ...options.workflow.provider.capabilities,
                toolCalling: true,
              },
              generate,
            },
          },
        },
        { ...observer, signal },
      ),
    );
    try {
      await store.synchronizeModel();
      const session = store.getSnapshot().activeId;
      const request = store.sendOwnedPrompt(
        session,
        '저장된 기록을 보여 주세요.',
        sender,
      );
      const identity = await request.requestIdentity;
      expect(identity).not.toBeNull();
      await Promise.race([
        entered.promise,
        request.completion.then(() => {
          throw new Error('Text settled before first tool');
        }),
      ]);
      const [nativeId] = work.mock.calls[0]!;
      expect(begin).toHaveBeenCalledTimes(1);
      expect(work).toHaveBeenCalledWith(nativeId, true);
      emit({
        kind: 'continued',
        requestId: nativeId,
        state: 'continued-granted',
      });
      phase = 'background';
      emit({ kind: 'phase' });
      if (mode === 'stop') store.cancel(session);
      if (mode === 'lock') {
        protection = false;
        emit({ kind: 'protectedData', available: false });
      }
      if (mode === 'expiry') emit({ kind: 'expired', requestId: nativeId });
      release.resolve();
      await request.completion;
      phase = 'active';
      emit({ kind: 'continuation-foreground' });
      await Promise.resolve();
      const outcome = await sender.mock.results[0]!.value;
      expect(outcome).toMatchObject(
        mode === 'admitted'
          ? { status: 'answer' }
          : { status: 'failure', kind: 'cancelled' },
      );
      expect(sender).toHaveBeenCalledTimes(1);
      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledTimes(mode === 'admitted' ? 1 : 0);
      expect(generate).toHaveBeenCalledTimes(mode === 'admitted' ? 3 : 1);
      expect(work.mock.calls.filter(([, active]) => active)).toEqual([
        [nativeId, true],
      ]);
      const signal = sender.mock.calls[0]![2];
      if (mode !== 'admitted') expect(signal?.aborted).toBe(true);
    } finally {
      release.resolve();
      store.dispose();
      local.store.dispose();
      local.close();
    }
  },
);
