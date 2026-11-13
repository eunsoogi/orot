import { AppState } from 'react-native';
import type { createConversationArtifactStorage } from '../storage/conversationArtifactStorage';
import type { createReplyNotificationLedger } from './replyNotificationLedger';
import {
  createReplyNotificationCoordinator,
  type ReplyIdentity,
} from './replyNotificationCoordinator';
import { nativeReplyNotifications } from './nativeReplyNotifications';
import { readCommittedReply } from './readCommittedReply';

type Storage = ReturnType<typeof createConversationArtifactStorage>;

/** Only a current committed identity may resolve a fresh saved answer for the local notification. */
export function createReplyCompletionConsumer(
  storage: Storage,
  ledger: ReturnType<typeof createReplyNotificationLedger>,
) {
  return async (requestId: string, valid: () => boolean = () => true) => {
    const coordinator = createReplyNotificationCoordinator({
      isBackground: () => valid() && AppState.currentState === 'background',
      isEnabled: async () => (await nativeReplyNotifications().read()).enabled,
      isAuthorized: () => nativeReplyNotifications().authorized(),
      lease: identity => nativeReplyNotifications().lease(identity.sessionId),
      claim: (id, eligible) => ledger.claim(id, eligible),
      release: id => ledger.release(id),
      start: id => ledger.start(id),
      finish: id => ledger.finish(id),
      async readAnswer(identity: ReplyIdentity) {
        return (await readCommittedReply(storage, identity))?.answer ?? null;
      },
      submit: (identity, preview, lease) =>
        nativeReplyNotifications().submit({ ...identity, preview, lease }),
    });
    const identity = (await storage.listCompletionIdentities()).find(
      value => value.requestId === requestId,
    );
    if (identity) {
      const { sessionId, messageId, sessionVersion } = identity;
      await coordinator.consume({
        requestId,
        sessionId,
        messageId,
        sessionVersion,
      });
    } else await ledger.finish(requestId);
  };
}
