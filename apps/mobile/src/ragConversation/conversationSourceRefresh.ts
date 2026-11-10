import { createEmptyConversation } from './conversationEmptySession';
import type {
  ConversationSessionOptions,
  ConversationSnapshot,
  ConversationSession,
} from './conversationSessionTypes';
import type { createConversationSessionRequests } from './conversationSessionRequests';
import type { createConversationSessionRestoreState } from './conversationSessionRestoreState';
import type { SourceDeletionEvent } from '../storage/localDataClearEvents';
import { filterHealthDerivedMessages } from './conversationHealthDeletion';

/** Withhold cached answers synchronously and reload only surviving durable turns. */
export function refreshConversationSources(input: {
  snapshot: ConversationSnapshot;
  event?: SourceDeletionEvent;
  options: ConversationSessionOptions;
  requests: ReturnType<typeof createConversationSessionRequests>;
  restoration: ReturnType<typeof createConversationSessionRestoreState>;
  update: (id: number, change: Partial<ConversationSession>) => void;
  apply: (change: Partial<ConversationSnapshot>) => void;
}) {
  const { snapshot, options, requests, restoration, update } = input;
  const [origin, deletedIds] = input.event ?? [];
  if (origin === 'healthkit') {
    const restrict = (session: ConversationSession) => ({
      messages: filterHealthDerivedMessages(session.messages, deletedIds),
      artifactContinuation: null,
      ...(session.pendingMessage
        ? {
            pendingMessage: {
              ...session.pendingMessage,
              content: '',
              withholdHealthBody: true,
              deletedHealthIds:
                deletedIds &&
                (!session.pendingMessage.withholdHealthBody ||
                  session.pendingMessage.deletedHealthIds)
                  ? new Set([
                      ...(session.pendingMessage.deletedHealthIds ?? []),
                      ...deletedIds,
                    ])
                  : undefined,
              toolEvents: session.pendingMessage.toolEvents?.filter(
                event => event.inputSummary.sourceKind === 'external_medical',
              ),
            },
          }
        : {}),
    });
    const deleted = snapshot.deleted;
    input.apply({
      sessions: snapshot.sessions.map(session => ({
        ...session,
        ...restrict(session),
      })),
      deleted: deleted
        ? {
            ...deleted,
            session: { ...deleted.session, ...restrict(deleted.session) },
          }
        : null,
    });
    for (const session of snapshot.sessions) {
      // Re-run only an already pending restore to fence its earlier storage read.
      const durableId = options.retention?.activeIdentity(session.id);
      if (session.restoring && durableId)
        restoration.start(session.id, durableId).catch(() => {});
    }
    return;
  }
  for (const session of snapshot.sessions) {
    requests.abandon(session.id);
    requests.forgetSaves(session.id);
    restoration.forget(session.id);
    const durableId = options.retention?.activeIdentity(session.id);
    update(session.id, {
      messages: [],
      title: createEmptyConversation(session.id).title,
      pendingMessage: null,
      unsavedCount: 0,
      error: '',
      restoreFailed: false,
      artifactContinuation: null,
    });
    if (durableId && options.restoreSession)
      restoration.start(session.id, durableId).catch(() => {});
  }
  // Undo snapshots may hold deleted source text even when their session is hidden.
  if (snapshot.deleted) {
    const handle = snapshot.deleted.handle;
    input.apply({ deleted: null });
    if (handle !== undefined)
      options.retention?.finalize(handle).catch(() => {});
  }
}
