import { AppState } from 'react-native';
import type { createConversationArtifactStorage } from '../storage/conversationArtifactStorage';
import { nativeReplyNotifications } from './nativeReplyNotifications';
import { readInterruptedReply } from './readInterruptedReply';

/** Call only after the protected interruption checkpoint is committed; never ask permission here. */
export async function notifyConversationInterruption(
  storage: Pick<
    ReturnType<typeof createConversationArtifactStorage>,
    'listInterruptedRequests'
  >,
  request: { requestId: string; sessionId: string; sessionVersion: number },
): Promise<void> {
  if (AppState.currentState !== 'background') return;
  const native = nativeReplyNotifications();
  if (!(await native.read()).enabled || !(await native.authorized())) return;
  const identity = {
    ...request,
    requestId: `interruption:${request.requestId}`,
    messageId: request.requestId,
    purpose: 'interruption' as const,
  };
  const lease = await native.lease(identity.sessionId);
  if (
    !(await readInterruptedReply(storage, identity)) ||
    AppState.currentState !== 'background'
  )
    return;
  // Native submission rechecks authorization, protected data and deletion epochs.
  await native.interrupt({ ...identity, lease });
}
