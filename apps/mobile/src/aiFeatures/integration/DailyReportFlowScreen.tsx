import { useMemo } from 'react';
import type { ReactNode } from 'react';
import type { EvidenceReference } from '@orot/agent-runtime';
import { createDailyReportIdentity } from '@orot/domain';
import { useAppointmentReminderRuntime } from '../../appointmentReminders/AppointmentReminderContext';
import type { AiFeatureServices } from './featureServices';
import { DailyReportRoute } from './DailyReportRoute';
import type { AiFeatureNavigationStateChange } from './useAiFeatureNavigationState';
import type { ConversationEntryContext } from './conversationIntent';
import { dailyReportConversationIntentStore } from './dailyReportConversationIntentStore';

/** Resolves a route-bound reminder or typed conversation request without changing its date. */
export function DailyReportFlowScreen({
  services,
  routeKey,
  providerSelection,
  onBack,
  onChat,
  onOpenSource,
  onNavigationStateChange,
  ownsOperation,
  fallback,
  inline = false,
  onTaskIdentity,
}: {
  services: AiFeatureServices;
  routeKey?: string;
  providerSelection: ReactNode;
  onBack: () => void;
  onChat: (
    target: NonNullable<ConversationEntryContext['dailyReport']>,
  ) => void;
  onOpenSource: (source: EvidenceReference) => void;
  onNavigationStateChange?: AiFeatureNavigationStateChange;
  ownsOperation?: boolean;
  fallback: ReactNode;
  inline?: boolean;
  onTaskIdentity?: (
    identity: import('@orot/domain').DailyReportIdentity,
  ) => Promise<void>;
}) {
  const runtime = useAppointmentReminderRuntime();
  const reminder = runtime?.dailyReportTargets.get(routeKey ?? '');
  const conversation = runtime?.dailyConversationTargets.get(routeKey ?? '');
  const identity = useMemo(
    () =>
      reminder
        ? createDailyReportIdentity(
            reminder.selectedRequest?.localDate ??
              reminder.dateInObservedTimeZone,
            reminder.selectedRequest?.timeZone ?? reminder.observedTimeZone,
          )
        : conversation
          ? createDailyReportIdentity(
              conversation.intent.request.localDate,
              conversation.intent.request.timeZone,
            )
          : undefined,
    [reminder, conversation],
  );
  return services.dailyReport ? (
    <DailyReportRoute
      feature={services.dailyReport}
      inline={inline}
      onTaskIdentity={onTaskIdentity}
      initialIdentity={identity}
      initialOperation={conversation?.operation}
      onSelectToday={
        reminder || conversation
          ? async request => {
              if (!runtime || !routeKey)
                throw new Error('Daily report route unavailable');
              if (reminder) {
                const select = runtime.dailyReportSelection.selectReminder;
                if (
                  !select ||
                  runtime.dailyReportTargets.get(routeKey)?.entryKey !==
                    reminder.entryKey
                )
                  throw new Error('Daily reminder route unavailable');
                const entry = await select(reminder.entryKey, request);
                if (
                  runtime.dailyReportTargets.get(routeKey)?.entryKey ===
                  reminder.entryKey
                )
                  runtime.dailyReportTargets.set(routeKey, entry);
              } else if (conversation) {
                if (
                  runtime.dailyConversationTargets.get(routeKey)?.intent
                    .entryKey !== conversation.intent.entryKey
                )
                  throw new Error('Daily conversation route unavailable');
                const intent = await dailyReportConversationIntentStore.select(
                  conversation.intent.entryKey,
                  request,
                );
                if (
                  runtime.dailyConversationTargets.get(routeKey)?.intent
                    .entryKey === conversation.intent.entryKey
                )
                  runtime.dailyConversationTargets.set(routeKey, { intent });
              }
            }
          : undefined
      }
      reminder={Boolean(reminder && !reminder.selectedRequest)}
      providerSelection={providerSelection}
      onBack={onBack}
      onChat={onChat}
      resolveSources={services.dailyReportSources}
      onOpenSource={onOpenSource}
      navigationRouteKey={routeKey}
      onNavigationStateChange={onNavigationStateChange}
      ownsOperation={ownsOperation}
    />
  ) : (
    fallback
  );
}
