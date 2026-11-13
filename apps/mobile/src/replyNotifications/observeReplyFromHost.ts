import { useEffect } from 'react';
import { AppState } from 'react-native';
import type { NavigationController } from '../navigation/navigationController';
import type { AppNavigationRoute } from '../routes/appNavigationRoute';
import type { ConversationSessions } from '../ragConversation/conversationSessions';
import type { ReplyDeliverySettings } from './replyDeliverySettings';
import { observeReplyDelivery } from './observeReplyDelivery';
import { useConversationSessions } from '../ragConversation/ConversationSessionsContext';

/** The shared executor owns the complete operation, so the leave guard must not reacquire its queue. */
export function observeReplyFromHost(
  input: ReplyDeliverySettings & {
    controller: NavigationController<AppNavigationRoute>;
    sessions: ConversationSessions;
  },
) {
  return observeReplyDelivery({
    controller: input.controller,
    sessions: input.sessions,
    retention: input.retention,
    loadLocalData: input.loadLocalData,
    confirm: routeKey =>
      input.controller.getSnapshot().currentRoute.key === routeKey
        ? input.controller.requestTabSwitchDecision()
        : Promise.resolve('busy'),
    canEnter: () =>
      AppState.currentState === 'active' && input.canEnterReply?.() === true,
    execute: input.executeReplyEntry,
    subscribeReady: input.subscribeReplyEntryReady,
    onReplyOpened: input.onReplyOpened,
  });
}

/** Keep the reply observer lifetime separate from the existing reminder drain. */
export function useReplyDeliveryFromHost(
  input: ReplyDeliverySettings & {
    controller: NavigationController<AppNavigationRoute>;
  },
) {
  const sessions = useConversationSessions();
  const {
    controller,
    retention,
    loadLocalData,
    canEnterReply,
    executeReplyEntry,
    subscribeReplyEntryReady,
    onReplyOpened,
  } = input;
  useEffect(
    () =>
      observeReplyFromHost({
        controller,
        sessions,
        retention,
        loadLocalData,
        canEnterReply,
        executeReplyEntry,
        subscribeReplyEntryReady,
        onReplyOpened,
      }),
    [
      controller,
      sessions,
      retention,
      loadLocalData,
      canEnterReply,
      executeReplyEntry,
      subscribeReplyEntryReady,
      onReplyOpened,
    ],
  );
}
