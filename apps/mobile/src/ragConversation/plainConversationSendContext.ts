import { providerHistoryMessage } from './conversationHistoryPayload';
import type { ConversationHistoryReaderOwner } from './conversationHistoryPage';
import type {
  ConversationSender,
  ConversationSession,
  ConversationSessionOptions,
} from './conversationSessionTypes';

export const usableHistoryMessages = (
  messages: ConversationSession['messages'],
) =>
  messages.filter(
    message =>
      !message.incomplete && !message.failed && !message.historyUnavailable,
  ).length;

export interface PlainHistoryPlan {
  readonly lease: { readonly id: string; readonly version: number };
  readonly turns: readonly { readonly id: string; readonly question: string }[];
  current(): boolean;
}

/** Keep the paged owner’s existing selection semantics for ordinary rows without
 * rendering, restoring tool events, or publishing historical bubbles during send. */
export async function planPlainHistory(
  read: ConversationSessionOptions['readPlainContextPage'],
  getOwner: () => ConversationHistoryReaderOwner | undefined,
  find: () => ConversationSession | undefined,
  signal: AbortSignal,
): Promise<PlainHistoryPlan | undefined> {
  const owner = getOwner();
  const session = find();
  const initial = owner?.cursor;
  if (
    !read ||
    !owner?.initialized ||
    owner.exhausted ||
    !initial ||
    !session ||
    session.restoring ||
    session.restoreFailed ||
    session.historyLoadFailed ||
    session.quarantined ||
    session.leaseRefreshRequired ||
    owner.flight ||
    signal.aborted ||
    usableHistoryMessages(session.messages) >= 8
  )
    return undefined;
  const lease = { id: owner.durableId, version: initial.version };
  const current = () => {
    const latest = find();
    return Boolean(
      latest &&
      !signal.aborted &&
      getOwner() === owner &&
      owner.initialized &&
      owner.durableId === lease.id &&
      !latest.restoring &&
      !latest.restoreFailed &&
      !latest.quarantined &&
      !latest.leaseRefreshRequired,
    );
  };
  // Cursor and flight are presentation state. They may move after the request
  // owns its frozen input, but may not change while collecting the snapshot.
  const collecting = () =>
    current() && owner.cursor === initial && !owner.flight;
  const previous = new Set(
    session.messages.map(message => message.toolMessageId),
  );
  let count = usableHistoryMessages(session.messages);
  let cursor: typeof initial | null = initial;
  let turns: PlainHistoryPlan['turns'] = [];
  while (cursor && count < 8) {
    const page = await read(lease.id, lease.version, signal, cursor);
    if (!collecting() || page.status !== 'plain') return undefined;
    const next = page.turns.filter(turn => !previous.has(turn.id));
    for (const turn of next) previous.add(turn.id);
    count += next.length * 2;
    turns = [...next, ...turns];
    // The actual app's keyset cursor always advances; don't let an injected port loop.
    if (
      page.nextCursor?.id === cursor.id &&
      page.nextCursor.createdAt === cursor.createdAt &&
      page.nextCursor.kind === cursor.kind
    )
      return undefined;
    cursor = page.nextCursor;
  }
  return { lease, turns, current };
}

/** This is a prompt-input plan, not proof of unchanged sources, tool permission
 * or transport consent. The existing selected history reader still verifies it. */
export function appendPlainHistoryToSender(
  send: ConversationSender,
  plan: PlainHistoryPlan,
): ConversationSender {
  return (question, history, signal, observer) => {
    if (
      !plan.current() ||
      signal?.aborted ||
      observer?.retentionSession?.id !== plan.lease.id ||
      observer.retentionSession.version !== plan.lease.version
    )
      return Promise.resolve({
        status: 'failure',
        kind: signal?.aborted ? 'cancelled' : 'unavailable',
      });
    // If scrolling published an overlapping page before the request froze its
    // input, keep that exact request snapshot and do not add the turns twice.
    const included = new Set(observer.retainedHistory?.map(turn => turn.id));
    const missing = plan.turns.filter(turn => !included.has(turn.id));
    const earlier = missing.flatMap(turn => [
      providerHistoryMessage({ role: 'user', content: turn.question }),
      providerHistoryMessage({ role: 'assistant', content: '' }),
    ]);
    return send(question, [...earlier, ...history], signal, {
      ...observer,
      retainedHistory: [...missing, ...(observer.retainedHistory ?? [])],
    });
  };
}

/** Joining cancellation releases this wait, never the scroll reader's ownership. */
export function joinConversationHistoryFlight(
  flight: Promise<void>,
  signal?: AbortSignal,
) {
  if (!signal) return flight;
  return new Promise<void>(resolve => {
    const finish = () => {
      signal.removeEventListener('abort', finish);
      resolve();
    };
    signal.addEventListener('abort', finish, { once: true });
    flight.then(finish, finish);
  });
}

/** Keep the probe local to the paged owner and absent from nonproduct callers. */
export function createPlainHistoryPlanner(
  input: {
    readPlainContextPage?: ConversationSessionOptions['readPlainContextPage'];
    find(id: number): ConversationSession | undefined;
  },
  owners: ReadonlyMap<number, ConversationHistoryReaderOwner>,
) {
  return (id: number, signal?: AbortSignal) =>
    input.readPlainContextPage && signal
      ? planPlainHistory(
          input.readPlainContextPage,
          () => owners.get(id),
          () => input.find(id),
          signal,
        )
      : undefined;
}
