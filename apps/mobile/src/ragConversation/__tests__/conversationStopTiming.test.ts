import { createConversationStopHandler } from '../conversationStoppedTurn';
import { createConversationActivity } from '../conversationActivity';
import { conversationExecutionDiagnostics } from '../conversationExecutionDiagnostics';
import type {
  ConversationSession,
  PendingTurn,
} from '../conversationSessionTypes';

test('acknowledges abort before waiting for a pending commit and records the later UI settlement', () => {
  jest.spyOn(Date, 'now').mockReturnValue(1000);
  let session = {
    id: 1,
    busy: true,
    draft: '',
    messages: [],
    pendingMessage: { id: 2, content: 'private partial' },
  } as unknown as ConversationSession;
  const controller = new AbortController();
  const turn = {
    saving: true,
    question: 'private prompt',
    userMessageId: 3,
  } as PendingTurn;
  const controllers = new Map([[1, controller]]);
  const pendingTurns = new Map([[1, turn]]);
  const snapshots = new Map([[1, createConversationActivity(1, 2)]]);
  const retain = jest.fn();
  const interrupt = jest.fn();
  const stop = createConversationStopHandler({
    controllers,
    pendingTurns,
    snapshots,
    activities: new Map(),
    lifetime: {
      status: () => undefined,
      interrupt,
      interruptionReason: () => undefined,
    } as unknown as Parameters<
      typeof createConversationStopHandler
    >[0]['lifetime'],
    find: () => session,
    update: (_, change) => {
      session = { ...session, ...change };
    },
    retainPartial: retain,
  });
  stop(1);
  expect(controller.signal.aborted).toBe(true);
  expect(interrupt).toHaveBeenCalledWith(1, 'cancelled');
  expect(session.busy).toBe(true);
  expect(session.requestActivity?.stage).toBe('cancelling');
  expect(controllers.get(1)).toBe(controller);
  expect(retain).not.toHaveBeenCalled();
  const sequence = conversationExecutionDiagnostics().at(-1)!.sequence;
  const observations = () =>
    conversationExecutionDiagnostics().filter(row => row.sequence === sequence);
  expect(observations().map(row => row.event)).toEqual([
    'stop-received',
    'abort-dispatched',
    'stop-awaiting-commit',
  ]);
  jest.spyOn(Date, 'now').mockReturnValue(6000);
  stop(1, true);
  expect(session.busy).toBe(false);
  expect(controllers.has(1)).toBe(false);
  expect(retain).toHaveBeenCalledTimes(1);
  expect(observations().at(-1)).toMatchObject({
    event: 'stop-presented',
    elapsedMs: 5000,
    phase: 'unknown',
  });
  const count = observations().length;
  stop(1);
  expect(observations()).toHaveLength(count);
  expect(JSON.stringify(observations())).not.toContain('private');
  jest.restoreAllMocks();
});
