import { createDailyReportIdentity } from '@orot/domain';
import { currentDailyReportContextRequest } from '../../healthEvidence/healthContext/dailyReportWindow';
import type { AppointmentReminderRuntime } from '../../appointmentReminders/AppointmentReminderContext';
import type { AiFeatureServices } from './featureServices';
import type { DailyReportConversationIntent } from './conversationIntent';

/** A typed, explicit conversation action starts the same shared report operation once. */
export function requestDailyReportFromConversation(input: {
  feature?: AiFeatureServices['dailyReport'];
  runtime: AppointmentReminderRuntime | null;
  navigate: () => { key: string } | null;
  now: string;
  timeZone: string;
}) {
  const { feature, runtime } = input;
  const request = currentDailyReportContextRequest(input.now, input.timeZone);
  if (
    !feature ||
    !runtime ||
    request.status !== 'ready' ||
    runtime.dailyConversationTargets.size
  )
    return;
  const target = input.navigate();
  if (!target) return;
  const intent: DailyReportConversationIntent = {
    kind: 'daily-report',
    entryKey: target.key,
    request: request.request,
  };
  const identity = createDailyReportIdentity(
    intent.request.localDate,
    intent.request.timeZone,
  );
  const operation = feature.start(identity, { kind: 'reuse_or_generate' });
  runtime.dailyConversationTargets.set(target.key, { intent, operation });
}
