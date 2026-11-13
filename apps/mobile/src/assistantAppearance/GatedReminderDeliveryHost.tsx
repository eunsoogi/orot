import { useEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';
import { AppointmentReminderDeliveryHost } from '../appointmentReminders/AppointmentReminderDeliveryHost';
import type { NavigationController } from '../navigation/navigationController';
import type { AppNavigationRoute } from '../routes/appNavigationRoute';
import type { AppRootTab } from '../navigation/rootTabs';
import type { ReplyDeliverySettings } from '../replyNotifications/replyDeliverySettings';
import { reconcileReplyPrivacy } from '../replyNotifications/reconcileReplyPrivacy';
import { nativeReplyNotifications } from '../replyNotifications/nativeReplyNotifications';
import { createEntryArbiter } from '../appEntry/entryArbiter';
import { RootURLDeliveryHost } from '../appEntry/RootURLDeliveryHost';
import { rootURLBridge } from '../appEntry/rootURLBridge';
import { useAssistantAppearance } from './AssistantAppearanceProvider';

export function GatedReminderDeliveryHost({
  controller,
  selectTab,
  ...replySettings
}: {
  controller: NavigationController<AppNavigationRoute>;
  selectTab: (tab: AppRootTab) => void;
} & Pick<ReplyDeliverySettings, 'retention' | 'loadLocalData'>) {
  const appearance = useAssistantAppearance();
  useEffect(reconcileReplyPrivacy, []);
  return (
    <ReminderGate
      controller={controller}
      ready={appearance?.ready === true}
      canEnter={appearance?.canEnter}
      selectTab={selectTab}
      {...replySettings}
    />
  );
}

/** Keep the existing inbox alive while preventing late async navigation through a closed gate. */
export function ReminderGate({
  controller,
  ready,
  canEnter,
  selectTab,
  retention,
  loadLocalData,
}: {
  controller: NavigationController<AppNavigationRoute>;
  ready: boolean;
  canEnter?: () => boolean;
  selectTab: (tab: AppRootTab) => void;
} & Pick<ReplyDeliverySettings, 'retention' | 'loadLocalData'>) {
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const canEnterRef = useRef(canEnter);
  canEnterRef.current = canEnter;
  const listeners = useMemo(() => new Set<() => void>(), []);
  const arbiter = useMemo(createEntryArbiter, []);
  const currentRun = useRef<(() => boolean) | null>(null);
  const explicitEntryWon = useRef(false);
  const allowed = useMemo(
    () => () =>
      readyRef.current &&
      (canEnterRef.current?.() ?? true) &&
      AppState.currentState === 'active',
    [],
  );
  const canEnterReply = useMemo(
    () => () => allowed() && (currentRun.current?.() ?? false),
    [allowed],
  );
  const canRestoreEntry = useMemo(
    () => async () => {
      try {
        if (explicitEntryWon.current || (await rootURLBridge.peek()) != null)
          return false;
        return (await nativeReplyNotifications().consumeTarget()) == null;
      } catch {
        return false;
      }
    },
    [],
  );
  const onSettled = useMemo(
    () => () => listeners.forEach(listener => listener()),
    [listeners],
  );
  const subscribeReady = useMemo(
    () => (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    [listeners],
  );
  const markExplicitEntry = useMemo(
    () => () => {
      explicitEntryWon.current = true;
    },
    [],
  );
  const execute = useMemo(
    () => (work: () => Promise<void>) =>
      arbiter.run(async current => {
        if (!current()) return;
        currentRun.current = current;
        try {
          await work();
        } finally {
          currentRun.current = null;
        }
      }),
    [arbiter],
  );
  const guarded = useMemo<NavigationController<AppNavigationRoute>>(
    () => ({
      ...controller,
      subscribe: listener => {
        listeners.add(listener);
        const unsubscribe = controller.subscribe(listener);
        return () => {
          listeners.delete(listener);
          unsubscribe();
        };
      },
      push: name =>
        allowed() && (currentRun.current?.() ?? false)
          ? controller.push(name)
          : null,
      replace: name =>
        allowed() && (currentRun.current?.() ?? false)
          ? controller.replace(name)
          : null,
      requestTabSwitchDecision: async () => {
        if (!allowed() || !(currentRun.current?.() ?? false)) return 'busy';
        const result = await controller.requestTabSwitchDecision();
        if (!(currentRun.current?.() ?? false)) return 'busy';
        if (result === 'declined') return result;
        return allowed() && (currentRun.current?.() ?? false) ? result : 'busy';
      },
    }),
    [allowed, controller, listeners],
  );
  useEffect(() => {
    if (ready) listeners.forEach(listener => listener());
  }, [ready, listeners]);
  useEffect(() => () => arbiter.invalidate(), [arbiter]);
  return (
    <>
      <RootURLDeliveryHost
        controller={controller}
        arbiter={arbiter}
        ready={ready}
        canEnter={allowed}
        selectTab={selectTab}
        onApplied={markExplicitEntry}
        onSettled={onSettled}
      />
      <AppointmentReminderDeliveryHost
        controller={guarded}
        retention={retention}
        loadLocalData={loadLocalData}
        canEnterReply={canEnterReply}
        executeReplyEntry={execute}
        subscribeReplyEntryReady={subscribeReady}
        onReplyOpened={markExplicitEntry}
        executeReminderEntry={execute}
        canRestoreEntry={canRestoreEntry}
        onExplicitReminderOpened={markExplicitEntry}
      />
    </>
  );
}
