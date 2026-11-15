import type {
  NavigationController,
  NavigationSnapshot,
} from '../navigation/navigationController';
import type { AppNavigationRoute } from '../routes/appNavigationRoute';
import type { ConversationSessions } from '../ragConversation/conversationSessions';
import type { ConversationSessionOptions } from '../ragConversation/conversationSessionTypes';
import type { ReplyIdentity } from './replyNotificationCoordinator';

/** Compare only the entry prerequisites, never drafts or other session publications. */
export function createReplyReadiness(input: {
  controller: NavigationController<AppNavigationRoute>;
  sessions: ConversationSessions;
  retention: NonNullable<ConversationSessionOptions['retention']>;
}) {
  let navigation: { key: string; busy: boolean } | undefined;
  let target: ReplyIdentity | undefined;
  let session: ReturnType<typeof readSession> | undefined;
  const readNavigation = () => {
    const snapshot = input.controller.getSnapshot();
    return { key: snapshot.currentRoute?.key, busy: snapshot.isTransitioning };
  };
  function readSession(identity: ReplyIdentity) {
    const found = input.sessions.getSnapshot?.().sessions.find(value => {
      const lease = input.retention.activeLease?.(value.id);
      return (
        lease?.id === identity.sessionId &&
        lease.version === identity.sessionVersion
      );
    });
    return {
      id: found?.id,
      busy: !!found?.busy,
      restoring: !!found?.restoring,
      failed: !!found?.restoreFailed,
      message: !!found?.messages.some(
        value =>
          value.role === 'assistant' &&
          (identity.purpose === 'interruption'
            ? value.incomplete && value.toolMessageId === identity.messageId
            : value.retainedTurnId === identity.messageId),
      ),
    };
  }
  const sameSession = (
    a: ReturnType<typeof readSession>,
    b: ReturnType<typeof readSession>,
  ) =>
    a.id === b.id &&
    a.busy === b.busy &&
    a.restoring === b.restoring &&
    a.failed === b.failed &&
    a.message === b.message;
  return {
    reset() {
      navigation = undefined;
      target = undefined;
      session = undefined;
    },
    navigation(
      snapshot: Pick<
        NavigationSnapshot<AppNavigationRoute>,
        'currentRoute' | 'isTransitioning'
      >,
    ) {
      navigation = {
        key: snapshot.currentRoute.key,
        busy: snapshot.isTransitioning,
      };
    },
    session(identity: ReplyIdentity) {
      target = identity;
      session = readSession(identity);
    },
    sessionChanged(identity: ReplyIdentity) {
      return !!session && !sameSession(session, readSession(identity));
    },
    waitForSession(identity: ReplyIdentity) {
      const current = readSession(identity);
      // A busy target must wake on its later settle, even when it returns to its old value.
      if (current.busy || current.restoring || current.failed)
        session = current;
    },
    changed() {
      const current = readNavigation();
      if (
        navigation &&
        !current.busy &&
        (navigation.key !== current.key || navigation.busy !== current.busy)
      )
        return true;
      if (!target || !session) return false;
      const next = readSession(target);
      return (
        !next.busy &&
        !next.restoring &&
        !next.failed &&
        !sameSession(session, next)
      );
    },
  };
}
