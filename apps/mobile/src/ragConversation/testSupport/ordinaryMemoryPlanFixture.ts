import { setConversationEntryForSession } from '../useConversationEntryIntent';
import type { ConversationSessions } from '../conversationSessions';
import type { SqlDatabase } from '@orot/storage';
import { createOrdinaryConversationMemoryEnrollmentStore } from '../../storage/ordinaryConversationMemoryEnrollment';
import {
  createChatGPTPlanProvider,
  type ChatGPTPlanNativeEvent,
  type ChatGPTPlanRequest,
} from '@orot/provider-openai';
import { authoredPlanModel } from '../../aiFeatures/integration/testSupport/syntheticAuthoredPlan';

export function ordinaryMemoryPlanFixture(
  tool: string,
  output: string,
  mode: string,
) {
  const requests: ChatGPTPlanRequest[] = [];
  const listeners = new Set<(event: ChatGPTPlanNativeEvent) => void>();
  const provider = createChatGPTPlanProvider({
    issuedClientID: 'synthetic-client',
    model: { slug: authoredPlanModel, displayName: 'Synthetic Plan' },
    requestIDFactory: () => 'transport-' + requests.length,
    bridge: {
      async listModels() {
        return [];
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      async startResponse(requestId, _client, request) {
        requests.push(request);
        const toolCall = {
          id: 'nomination',
          name: tool,
          arguments: JSON.stringify({
            sentence: mode === 'invalid ordinal' ? 2 : 1,
          }),
        };
        for (const emit of listeners) {
          if (requests.length === 1 && mode !== 'omitted') {
            emit({ requestId, type: 'tool_call', toolCall });
            emit({
              requestId,
              type: 'completed',
              text: '',
              toolCalls: [toolCall],
            });
          } else {
            const text = JSON.stringify({
              type: 'result',
              value: { answerKind: 'conversation', answer: output },
              citations: [],
            });
            emit({ requestId, type: 'text_delta', text });
            emit({ requestId, type: 'completed', text, toolCalls: [] });
          }
        }
      },
      cancelResponse() {},
    },
  });
  return { provider, requests };
}

export function testOrdinaryMemoryOwner() {
  type Execution =
    import('../conversationExecutionLease').ConversationExecutionAdapter;
  const listeners = new Set<Parameters<Execution['subscribe']>[0]>();
  const execution: Execution = {
    bridgeAvailable: true,
    currentPhase: () => 'active',
    async begin() {
      return true;
    },
    end() {},
    async isActive() {
      return true;
    },
    async protectedDataAvailable() {
      return true;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    execution,
    retire: () => {
      for (const listener of listeners) listener({ kind: 'phase' });
    },
    listenerCount: () => listeners.size,
  };
}

export async function ordinaryMemoryEnrollmentFixture(
  database: SqlDatabase,
  mode: string,
) {
  const deviceEpoch = 'a'.repeat(64);
  const enrollment = createOrdinaryConversationMemoryEnrollmentStore(database);
  const receipt = await enrollment.replace(
    await enrollment.read(),
    mode === 'opted out' ? null : deviceEpoch,
    () => true,
  );
  if (!receipt) throw new Error('Expected current synthetic enrollment.');
  const capture = jest.fn(async () =>
    mode === 'opted out'
      ? undefined
      : {
          database: database,
          generation: receipt.generation,
          deviceEpoch,
          scope: 'reply-preferences' as const,
          isCurrent: () => true,
        },
  );
  return { enrollment, receipt, capture };
}

/** Seed the same owned route metadata left by a real Possibilities shortcut. */
export function seedOrdinaryMemoryDraft(
  store: ConversationSessions,
  activeId: number,
  preference: string,
  route: 'ordinary' | 'possibilities',
) {
  if (route === 'possibilities')
    setConversationEntryForSession(store, activeId, {
      intent: 'possibilities',
      entryKey: 'synthetic-possibilities',
    });
  store.setDraft(activeId, preference);
}
