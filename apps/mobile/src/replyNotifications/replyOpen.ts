import type { ConversationSessions } from '../ragConversation/conversationSessions';
import type { ConversationSessionOptions } from '../ragConversation/conversationSessionTypes';
import type { NavigationController } from '../navigation/navigationController';
import type { AppNavigationRoute } from '../routes/appNavigationRoute';
import type { ReplyIdentity } from './replyNotificationCoordinator';
import { replyFocus } from './replyFocus';

/** Resolve the exact protected reply before selecting a session; no send operation is involved. */
export function createReplyOpen(input: {
  controller: NavigationController<AppNavigationRoute>;
  sessions: ConversationSessions;
  retention: ConversationSessionOptions['retention'];
  read(identity: ReplyIdentity): Promise<{ createdAt: string } | null>;
  canEnter(): boolean;
  isCurrent?(): boolean;
  signal?: AbortSignal;
  onReplyOpened?: () => void;
  onBlocked?(reason: 'navigation' | number): void;
  confirm(
    routeKey: string,
  ): Promise<'approved' | 'declined' | 'unavailable' | 'busy'>;
}) {
  return async (
    identity: ReplyIdentity,
  ): Promise<'opened' | 'missing' | 'deferred' | 'cancelled'> => {
    const currentOwner = input.isCurrent ?? (() => true);
    if (!currentOwner() || !input.canEnter() || !input.retention)
      return 'deferred';
    try {
      const answer = await input.read(identity);
      if (!currentOwner() || !input.canEnter()) return 'deferred';
      if (!answer) return 'missing';
      const before = input.controller.getSnapshot();
      const decision = await input.confirm(before.currentRoute.key);
      if (!currentOwner()) return 'deferred';
      if (decision === 'declined') return 'cancelled';
      if (!input.canEnter()) return 'deferred';
      if (decision === 'busy') input.onBlocked?.('navigation');
      if (decision !== 'approved') return 'deferred';
      const existing = input.sessions.getSnapshot().sessions.find(session => {
        const lease = input.retention?.activeLease(session.id);
        return (
          lease?.id === identity.sessionId &&
          lease.version === identity.sessionVersion
        );
      });
      const sessionId =
        existing?.id ??
        (await input.sessions.attachExisting(
          identity.sessionId,
          identity.sessionVersion,
          answer.createdAt,
          false,
          currentOwner,
          input.signal,
        ));
      if (!currentOwner() || !input.canEnter()) return 'deferred';
      let session = input.sessions
        .getSnapshot()
        .sessions.find(value => value.id === sessionId);
      if (session?.restoreFailed) {
        await input.sessions.retryRestore(sessionId, input.signal);
        if (!currentOwner() || !input.canEnter()) return 'deferred';
        session = input.sessions
          .getSnapshot()
          .sessions.find(value => value.id === sessionId);
      }
      if (session?.busy || session?.restoring || session?.restoreFailed) {
        input.onBlocked?.(sessionId);
        return 'deferred';
      }
      if (
        !session?.messages.some(
          message =>
            message.role === 'assistant' &&
            message.retainedTurnId === identity.messageId,
        )
      )
        return 'missing';
      const latest = await input.read(identity);
      if (!currentOwner() || !input.canEnter()) return 'deferred';
      if (!latest) return 'missing';
      const current = input.controller.getSnapshot();
      if (
        !currentOwner() ||
        !input.canEnter() ||
        current.isTransitioning ||
        current.currentRoute.key !== before.currentRoute.key
      )
        return 'deferred';
      if (
        current.currentRoute.name !== 'rag-conversation' &&
        !input.controller.push('rag-conversation')
      )
        return 'deferred';
      // Navigation and selection publish synchronously and can replace this observer.
      if (!currentOwner() || !input.canEnter()) return 'deferred';
      input.sessions.select(sessionId);
      if (!currentOwner() || !input.canEnter()) return 'deferred';
      replyFocus.set({ sessionId, messageId: identity.messageId });
      if (!currentOwner() || !input.canEnter()) return 'deferred';
      input.onReplyOpened?.();
      return 'opened';
    } catch {
      // Protected data and transient restoration failures leave the durable inbox untouched.
      return 'deferred';
    }
  };
}
