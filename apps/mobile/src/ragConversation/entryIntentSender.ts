import { bindDailyReportMemoryTap } from './conversationDailyReportMemoryJobs';
import { todayIdentity } from '../aiFeatures/integration/dailyReportTodayIdentity';
import { isTypedTodayDailyReportRequest } from './typedTodayDailyReportRequest';
import type { DailyReportMemoryTap } from '../storage/dailyReportMemoryTap';
import { allowWarmConversationSender } from './warmConversationSender';
import type { ConversationSessions } from './conversationSessions';
import type { ConversationScreenProps } from './ConversationScreenProps';
import type { ConversationSender } from './conversationSessionTypes';
import {
  conversationEntryForSession,
  consumeConversationEntryForSession,
} from './useConversationEntryIntent';

/** Retain entry intent for failed retries; a committed summary survives late cancellation. */
export function entryIntentSender(
  store: ConversationSessions,
  id: number,
  send: ConversationScreenProps['onSend'],
  inputOrigin: 'composer' | 'shortcut' = 'shortcut',
  reportOrigin?: 'direct-user-tap',
  reportTap?: DailyReportMemoryTap,
): ConversationSender {
  // Freeze the selected source before storage preflight can yield to another selection.
  const selected = conversationEntryForSession(store, id);
  const restored = store.getSnapshot().sessions.find(item => item.id === id);
  const draft = restored?.draft.trim();
  // Pin the local day at the explicit send, not after asynchronous preflight.
  const typedToday =
    inputOrigin === 'composer' &&
    draft &&
    isTypedTodayDailyReportRequest(draft) &&
    !restored?.dailyReport &&
    !selected?.appointmentId &&
    !selected?.dailyReport &&
    (!selected?.reportRequest || selected.intent === 'conversation') &&
    store.photoDrafts.get(id).status === 'empty';
  const typedDay = typedToday ? todayIdentity() : null;
  const dispatch: ConversationSender = async (
    question,
    history,
    signal,
    observer,
  ) => {
    const isTodayCommand =
      typedToday && question.trim() === draft && !observer?.photoInput;
    if (isTodayCommand && !typedDay)
      return { status: 'failure', kind: 'unavailable' };
    // Restored targets are revalidated by the same guard used for the original entry.
    // Restored possibility sessions retain their safety and grounding boundary on follow-up.
    const context =
      isTodayCommand && typedDay
        ? {
            intent: 'daily-report' as const,
            entryKey: `conversation-report:${id}`,
            reportRequest: typedDay,
          }
        : selected && selected.intent !== 'conversation'
          ? {
              ...selected,
              ...(restored?.dailyReport
                ? { dailyReport: restored.dailyReport }
                : {}),
            }
          : restored?.dailyReport
            ? {
                intent: restored.entryIntent ?? ('conversation' as const),
                entryKey: 'restored',
                dailyReport: restored.dailyReport,
              }
            : restored?.entryIntent === 'possibilities' &&
                (!selected || selected.intent === 'conversation')
              ? { intent: 'possibilities' as const, entryKey: 'restored' }
              : selected;
    let committed = false;
    const scopedObserver = {
      ...observer,
      inputOrigin,
      onSummarySaveSettled(value: boolean) {
        committed = value;
        observer?.onSummarySaveSettled?.(value);
      },
    };
    if (reportOrigin && reportTap)
      bindDailyReportMemoryTap(scopedObserver, reportTap);
    const outcome = context
      ? await send(
          question,
          history,
          signal,
          scopedObserver,
          reportOrigin && selected?.intent === 'daily-report'
            ? { ...context, directDailyReportRequest: true }
            : context,
        )
      : await send(question, history, signal, scopedObserver);
    if (
      (!signal?.aborted || committed) &&
      outcome.status !== 'failure' &&
      outcome.status !== 'unavailable'
    ) {
      consumeConversationEntryForSession(store, id);
      store.setEntryPrompt(id, undefined);
    }
    return outcome;
  };
  return !typedToday &&
    !restored?.dailyReport &&
    !selected?.dailyReport &&
    !selected?.reportRequest &&
    !selected?.appointmentId &&
    (!selected ||
      selected.intent === 'conversation' ||
      selected.intent === 'possibilities')
    ? allowWarmConversationSender(dispatch)
    : dispatch;
}
