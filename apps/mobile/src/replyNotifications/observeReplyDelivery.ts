import { Alert, AppState } from 'react-native';
import type { NavigationController } from '../navigation/navigationController';
import type { AppNavigationRoute } from '../routes/appNavigationRoute';
import type { ConversationSessions } from '../ragConversation/conversationSessions';
import type { ConversationSessionOptions } from '../ragConversation/conversationSessionTypes';
import type { AiFeatureLocalData } from '../aiFeatures/integration/localData';
import { subscribeAppointmentReminderOpened } from '../appointmentReminders/nativeReminderBridge';
import { t } from '../i18n';
import { nativeReplyNotifications } from './nativeReplyNotifications';
import { readCommittedReply } from './readCommittedReply';
import { createReplyDestination } from './replyDestination';
import { createReplyOpen } from './replyOpen';
import type { ReplyEntryExecutor } from './replyDeliverySettings';

/** Reuse the existing reminder wake signal and navigation decision queue for reply taps. */
export function observeReplyDelivery(input: {
  controller: NavigationController<AppNavigationRoute>;
  sessions: ConversationSessions;
  retention: ConversationSessionOptions['retention'];
  loadLocalData?: () => Promise<AiFeatureLocalData>;
  confirm(
    routeKey: string,
  ): Promise<'approved' | 'declined' | 'unavailable' | 'busy'>;
  canEnter(): boolean;
  execute?: ReplyEntryExecutor;
  subscribeReady?: (listener: () => void) => () => void;
  onReplyOpened?: () => void;
}) {
  if (!input.retention || !input.execute) return () => {};
  const execute = input.execute;
  let active = true;
  const lifetime = new AbortController();
  const open = createReplyOpen({
    ...input,
    isCurrent: () => active,
    signal: lifetime.signal,
    async read(identity) {
      const data = await (input.loadLocalData
        ? input.loadLocalData()
        : import('../aiFeatures/integration/localData').then(module =>
            module.openAiFeatureLocalData(),
          ));
      if (!data.openConversationArtifactStorage)
        throw new Error('Protected storage is unavailable.');
      return readCommittedReply(
        await data.openConversationArtifactStorage(),
        identity,
      );
    },
  });
  const deliver = createReplyDestination({
    consume: () => nativeReplyNotifications().consumeTarget(),
    acknowledge: id => nativeReplyNotifications().acknowledgeTarget(id),
    discardInvalid: () => nativeReplyNotifications().discardInvalidTarget(),
    isCurrent: () => active,
    open,
    unavailable: () =>
      Alert.alert(
        t('replyNotification.missingTitle'),
        t('replyNotification.missingBody'),
      ),
  });
  let pending = false;
  let queue = Promise.resolve();
  const drain = () => {
    if (!active) return;
    queue = queue
      .then(async () => {
        if (!active) return;
        // An entry owner may defer without invoking the callback while its gate is closed.
        pending = true;
        await execute(async () => {
          if (!active) return;
          const result = await deliver();
          if (!active) return;
          pending = result === 'deferred';
          if (
            result === 'opened' ||
            result === 'missing' ||
            result === 'cancelled' ||
            result === 'invalid'
          )
            drain();
        });
      })
      .catch(() => {
        pending = true;
      });
  };
  let unsubscribe = () => {};
  try {
    unsubscribe = subscribeAppointmentReminderOpened(drain);
  } catch {
    /* A later foreground entry can retry. */
  }
  const state = AppState.addEventListener('change', value => {
    if (value === 'active') drain();
  });
  const navigation = input.controller.subscribe(() => {
    if (pending && !input.controller.getSnapshot().isTransitioning) {
      pending = false;
      drain();
    }
  });
  const sessions = input.sessions.subscribe(() => {
    if (pending) {
      pending = false;
      drain();
    }
  });
  const ready = input.subscribeReady?.(drain) ?? (() => {});
  drain();
  return () => {
    active = false;
    lifetime.abort();
    unsubscribe();
    state.remove();
    navigation();
    sessions();
    ready();
  };
}
