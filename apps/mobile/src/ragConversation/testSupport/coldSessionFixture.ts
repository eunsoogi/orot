import { coldPausedConversationFixture } from '../../aiFeatures/integration/testSupport/coldPausedConversationFixture';
import { createColdConversationServices } from '../../aiFeatures/integration/coldConversationServices';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationSessionRequests } from '../conversationSessionRequests';
import { createEmptyConversation } from '../conversationEmptySession';
import type { ConversationSession } from '../conversationSessionTypes';
import type {
  ConversationExecutionAdapter,
  ConversationExecutionEvent,
} from '../conversationExecutionLease';

export async function coldSessionFixture() {
  const f = await coldPausedConversationFixture();
  const createId = jest.fn(() => 'unexpected-new-request');
  const retention = createConversationSessionRetention({
    openStorage: async () => f.storage,
    createId,
    now: () => '2026-11-14T01:00:00.000Z',
  });
  await retention.attachExisting(1, 'session', 0);
  let session: ConversationSession = {
    ...createEmptyConversation(1),
    draft: 'unsent next question',
    messages: [
      { id: -1, role: 'user', content: f.options.request },
      {
        id: -2,
        role: 'assistant',
        content: 'preview',
        toolMessageId: 'request',
        incomplete: true,
        interruptionReason: 'decision-required',
        coldResume: { attempt: 0 },
      },
    ],
  };
  let listener: ((event: ConversationExecutionEvent) => void) | undefined;
  const begin = jest.fn(async (_id: string) => true);
  const execution: ConversationExecutionAdapter = {
    currentPhase: () => 'active',
    begin,
    end: jest.fn(),
    isActive: async () => true,
    protectedDataAvailable: async () => true,
    subscribe: next => {
      listener = next;
      return () => {
        if (listener === next) listener = undefined;
      };
    },
  };
  const cold = createColdConversationServices(
    f.dependencies,
    async () => f.connection.database,
  );
  const requests = createConversationSessionRequests(
    () => session,
    (_id, change) => {
      session = { ...session, ...change };
    },
    () => 'scope',
    retention,
    execution,
    undefined,
    cold,
  );
  return {
    ...f,
    requests,
    cold,
    retention,
    createId,
    begin,
    session: () => session,
    expire: () =>
      listener?.({ kind: 'expired', requestId: begin.mock.calls.at(-1)![0] }),
    pause: () =>
      listener?.({
        kind: 'pause-requested',
        requestId: begin.mock.calls.at(-1)![0],
      }),
  };
}
