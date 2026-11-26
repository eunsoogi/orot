import { personalSourceCaptures } from './personalToolSourceRoute';
import type { ResolveConversationToolSource } from './ConversationToolEventSources';
import type { ConversationSessions } from './conversationSessions';

type SourceOwner = Pick<
  ConversationSessions,
  'getSnapshot' | 'ownsActiveSession' | 'savedReportLease' | 'subscribe'
>;

/** The row is only a location claim; durable source verification still belongs to the resolver. */
export function guardPersonalToolSource(
  store: SourceOwner,
  id: number,
  resolve: ResolveConversationToolSource | undefined,
): ResolveConversationToolSource | undefined {
  if (!resolve) return undefined;
  const capture: NonNullable<ReturnType<typeof personalSourceCaptures.get>> = (
    source,
    scope,
  ) => {
    if (source.sourceKind !== 'personal_record') return undefined;
    const lease = store.savedReportLease(id);
    const owns = () => {
      const activeLease = store.savedReportLease(id);
      if (
        !scope.durableMessageId ||
        !store.ownsActiveSession(id) ||
        !lease ||
        lease.id !== scope.sessionId ||
        activeLease?.id !== lease.id ||
        activeLease.version !== lease.version
      )
        return false;
      const session = store.getSnapshot().sessions.find(item => item.id === id);
      if (
        !session ||
        session.quarantined ||
        session.restoring ||
        session.leaseRefreshRequired
      )
        return false;
      const rows = [session.pendingMessage, ...session.messages].filter(
        row => row?.toolMessageId === scope.durableMessageId,
      );
      if (rows.length !== 1 || rows[0]?.sourceOwner) return false;
      const events = rows[0]?.toolEvents?.filter(
        event =>
          event.operationRunId === scope.operationRunId &&
          event.callId === scope.callId,
      );
      return (
        events?.length === 1 &&
        events[0]?.sources.filter(
          candidate =>
            candidate.sourceKind === source.sourceKind &&
            candidate.sourceId === source.sourceId &&
            candidate.sourceRevision === source.sourceRevision &&
            candidate.evidenceId === source.evidenceId &&
            candidate.evidenceRevision === source.evidenceRevision,
        ).length === 1
      );
    };
    if (!owns()) return undefined;
    const controller = new AbortController();
    let admitted = false;
    const retire = () => controller.abort();
    const current = () => {
      if (!owns()) retire();
      return !controller.signal.aborted;
    };
    const stop = store.subscribe(() => {
      current();
    });
    controller.signal.addEventListener('abort', stop, { once: true });
    return {
      signal: controller.signal,
      current,
      retire,
      async admit() {
        if (admitted || !current()) return undefined;
        admitted = true;
        const verified = await resolve(source, controller.signal, scope);
        return current() ? verified : undefined;
      },
    };
  };
  const guarded: ResolveConversationToolSource = async (
    source,
    signal,
    scope,
  ) => {
    if (source.sourceKind !== 'personal_record')
      return resolve(source, signal, scope);
    const owner = !signal.aborted && capture(source, scope);
    if (!owner) return undefined;
    signal.addEventListener('abort', owner.retire, { once: true });
    try {
      return await owner.admit();
    } finally {
      signal.removeEventListener('abort', owner.retire);
      owner.retire();
    }
  };
  personalSourceCaptures.set(guarded, capture);
  return guarded;
}
