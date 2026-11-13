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
  let blocked: 'navigation' | number | null = null;
  const open = createReplyOpen({
    ...input,
    onBlocked: reason => {
      blocked = reason;
    },
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
  let running = false;
  let navigationWasBusy = input.controller.getSnapshot().isTransitioning;
  let busySessions = new Set<number>();
  let navigationReady = false;
  const readySessions = new Set<number>();
  const readBusySessions = () =>
    new Set(
      (input.sessions.getSnapshot?.().sessions ?? [])
        .filter(
          session => session.busy || session.restoring || session.restoreFailed,
        )
        .map(session => session.id),
    );
  busySessions = readBusySessions();
  let queue = Promise.resolve();
  const drain = () => {
    if (!active) return;
    queue = queue
      .then(async () => {
        if (!active) return;
        // An entry owner may defer without invoking the callback while its gate is closed.
        pending = true;
        running = true;
        blocked = null;
        navigationReady = false;
        readySessions.clear();
        try {
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
        } finally {
          running = false;
          // Only a readiness transition for the actual blocker can wake an in-flight defer.
          if (
            pending &&
            (blocked === 'navigation'
              ? navigationReady
              : blocked !== null && readySessions.has(blocked))
          ) {
            pending = false;
            drain();
          }
        }
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
    const busy = input.controller.getSnapshot().isTransitioning;
    if (running && navigationWasBusy && !busy) navigationReady = true;
    navigationWasBusy = busy;
    if (
      pending &&
      !running &&
      !input.controller.getSnapshot().isTransitioning
    ) {
      pending = false;
      drain();
    }
  });
  const sessions = input.sessions.subscribe(() => {
    const nextBusy = readBusySessions();
    if (running)
      for (const id of busySessions)
        if (!nextBusy.has(id)) readySessions.add(id);
    busySessions = nextBusy;
    if (pending && !running) {
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
