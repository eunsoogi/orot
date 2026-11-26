import { answerMemorySelection } from '../../aiFeatures/integration/conversationAnswerMemoryAdmission';
import { archivedConversationAnswerTarget } from '../archivedConversationAnswerTarget';
import type { DisplayMessage } from '../ConversationMessage';
import { retainedHistoryTurns } from '../conversationHistoryPayload';
import type { ConversationSession } from '../conversationSessionTypes';

const question: DisplayMessage = {
  id: 1,
  role: 'user',
  content: 'Fixture original question',
};
const original: DisplayMessage = {
  id: 2,
  role: 'assistant',
  content: 'Fixture completed answer',
  retainedTurnId: 'exact-local-answer',
};
const request: DisplayMessage = {
  id: 9,
  role: 'user',
  content: 'Then remember that.',
};

function select(messages: readonly DisplayMessage[]) {
  const session = { messages } as ConversationSession;
  const retainedHistory = retainedHistoryTurns(messages, request.content);
  const archivedAnswerMemoryTarget = archivedConversationAnswerTarget({
    session,
    find: () => session,
    lease: () => undefined,
    current: () => true,
    currentUserId: request.id,
    priorRetainedAnswerId: retainedHistory.at(-1)?.id,
  });
  return answerMemorySelection({
    observer: { archivedAnswerMemoryTarget, retainedHistory },
    admittedAnswerIds: new Set([original.retainedTurnId!]),
  });
}

test.each([false, true])(
  'only the current user request is excluded from visible target selection: %s',
  appended => {
    const exact = select([question, original, ...(appended ? [request] : [])]);
    expect(exact.target?.id).toBe(original.retainedTurnId);
    expect(exact.eligible).toBe(true);
  },
);

const secondary = { id: 3, role: 'user', content: 'Another question' } as const;
const unresolved = {
  id: 4,
  role: 'assistant',
  content: 'Newer display row',
} as const;

test.each([
  { label: 'unretained reply', latest: [secondary, unresolved] },
  {
    label: 'failed current topic',
    latest: [{ ...secondary, failed: true }],
  },
  {
    label: 'partial or streaming reply',
    latest: [secondary, { ...unresolved, incomplete: true, streaming: true }],
  },
  {
    label: 'unavailable source',
    latest: [{ ...unresolved, historyUnavailable: true }],
  },
  {
    label: 'clarification',
    latest: [{ ...unresolved, localClarification: true }],
  },
  {
    label: 'newer retained identity not admitted',
    target: 'other-id',
    latest: [secondary, { ...unresolved, retainedTurnId: 'other-id' }],
  },
  {
    label: 'retained ID no longer associated with its preceding question',
    latest: [{ ...unresolved, retainedTurnId: 'other-id' }],
  },
] as { label: string; latest: readonly DisplayMessage[]; target?: string }[])(
  'does not fall back to an older durable answer after $label',
  ({ latest, target }) => {
    const selected = select([question, original, ...latest, request]);
    expect(selected.eligible).toBeFalsy();
    if (target) expect(selected.target?.id).toBe(target);
    else expect(selected.target).toBeNull();
  },
);
