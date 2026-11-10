import { createDailyReportIdentity } from '@orot/domain';
import { currentDailyReportContextRequest } from '../../healthEvidence/healthContext/dailyReportWindow';
import type { AppointmentReminderRuntime } from '../../appointmentReminders/AppointmentReminderContext';
import type { AiFeatureServices } from './featureServices';
import type { DailyReportConversationIntent } from './conversationIntent';
import { operationRunId } from './featureRunIdentity';
import { dailyReportConversationIntentStore } from './dailyReportConversationIntentStore';

const pending = new WeakSet<AppointmentReminderRuntime>();
export const hasPendingDailyConversationEntry = (
  runtime: AppointmentReminderRuntime,
) => pending.has(runtime);

/** A typed, explicit conversation action starts the same shared report operation once. */
export async function requestDailyReportFromConversation(input: {
  feature?: AiFeatureServices['dailyReport'];
  runtime: AppointmentReminderRuntime | null;
  navigate: () => { key: string } | null;
  now: string;
  timeZone: string;
  isCurrent: () => boolean;
  store?: Pick<
    typeof dailyReportConversationIntentStore,
    'activate' | 'dismiss'
  >;
}) {
  const { feature, runtime } = input;
  const request = currentDailyReportContextRequest(input.now, input.timeZone);
  if (!feature || !runtime || request.status !== 'ready' || !input.isCurrent())
    return 'unavailable' as const;
  if (runtime.dailyConversationTargets.size || pending.has(runtime))
    return 'busy' as const;
  const intent: DailyReportConversationIntent = {
    kind: 'daily-report',
    entryKey: `daily-conversation:${operationRunId()}`,
    request: request.request,
  };
  const store = input.store ?? dailyReportConversationIntentStore;
  pending.add(runtime);
  let target: { key: string } | null = null;
  try {
    // Restore the selected date after a crash, but never restart inference automatically.
    await store.activate(intent);
    if (!input.isCurrent()) {
      await store.dismiss(intent.entryKey);
      return 'abandoned' as const;
    }
    target = input.navigate();
    if (!target) {
      await store.dismiss(intent.entryKey);
      return 'unavailable' as const;
    }
    runtime.dailyConversationTargets.set(target.key, { intent });
    const identity = createDailyReportIdentity(
      intent.request.localDate,
      intent.request.timeZone,
    );
    const operation = feature.start(identity, { kind: 'reuse_or_generate' });
    runtime.dailyConversationTargets.set(target.key, { intent, operation });
    return 'opened' as const;
  } catch {
    if (!target) await store.dismiss(intent.entryKey).catch(() => undefined);
    return 'unavailable' as const;
  } finally {
    pending.delete(runtime);
  }
}
