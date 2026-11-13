import { AppState } from 'react-native';
import type { createConversationArtifactStorage } from '../storage/conversationArtifactStorage';
import type { createReplyNotificationLedger } from './replyNotificationLedger';
import {
  createReplyNotificationCoordinator,
  type ReplyIdentity,
} from './replyNotificationCoordinator';
import { nativeReplyNotifications } from './nativeReplyNotifications';

type Storage = ReturnType<typeof createConversationArtifactStorage>;

/** Only a current committed identity may resolve a fresh saved answer for the local notification. */
export function createReplyCompletionConsumer(
  storage: Storage,
  ledger: ReturnType<typeof createReplyNotificationLedger>,
) {
  const coordinator = createReplyNotificationCoordinator({
    isBackground: () => AppState.currentState === 'background',
    isEnabled: async () => (await nativeReplyNotifications().read()).enabled,
    isAuthorized: () => nativeReplyNotifications().authorized(),
    claim: id => ledger.claim(id),
    async readAnswer(identity: ReplyIdentity) {
      const current = (await storage.listCompletionIdentities()).some(
        value =>
          value.requestId === identity.requestId &&
          value.sessionId === identity.sessionId &&
          value.messageId === identity.messageId &&
          value.sessionVersion === identity.sessionVersion,
      );
      if (!current) return null;
      const [answer] = await storage.readSessionMany(
        identity.sessionId,
        identity.sessionVersion,
        [identity.messageId],
      );
      return answer?.status === 'complete' ? answer.answer : null;
    },
    async submit(identity, preview) {
      await nativeReplyNotifications().submit({ ...identity, preview });
    },
  });
  return async (requestId: string) => {
    const identity = (await storage.listCompletionIdentities()).find(
      value => value.requestId === requestId,
    );
    if (identity) {
      const { requestId, sessionId, messageId, sessionVersion } = identity;
      await coordinator.consume({
        requestId,
        sessionId,
        messageId,
        sessionVersion,
      });
    }
  };
}
