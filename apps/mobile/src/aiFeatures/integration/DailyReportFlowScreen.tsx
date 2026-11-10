import { useMemo } from 'react';
import type { ReactNode } from 'react';
import type { EvidenceReference } from '@orot/agent-runtime';
import { createDailyReportIdentity } from '@orot/domain';
import { useAppointmentReminderRuntime } from '../../appointmentReminders/AppointmentReminderContext';
import type { AiFeatureServices } from './featureServices';
import { DailyReportRoute } from './DailyReportRoute';
import type { AiFeatureNavigationStateChange } from './useAiFeatureNavigationState';
import type { ConversationEntryContext } from './conversationIntent';

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
}) {
  const runtime = useAppointmentReminderRuntime();
  const reminder = runtime?.dailyReportTargets.get(routeKey ?? '');
  const conversation = runtime?.dailyConversationTargets.get(routeKey ?? '');
  const identity = useMemo(
    () =>
      reminder
        ? createDailyReportIdentity(
            reminder.dateInObservedTimeZone,
            reminder.observedTimeZone,
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
      initialIdentity={identity}
      initialOperation={conversation?.operation}
      reminder={Boolean(reminder)}
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
