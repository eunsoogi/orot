import { startConversationReportTurn } from '../ragConversation/startConversationReportTurn';
import { useEffect, useRef } from 'react';
import type { ConversationSessions } from '../ragConversation/conversationSessions';
import type { AiFeatureServices } from '../aiFeatures/integration/featureServices';
import {
  dailyReminderPromptRendezvous,
  mountDailyReminderConversationPrompt,
} from './dailyReminderPromptRendezvous';

export function useDailyReminderPrompt(input: {
  canonical: boolean | undefined;
  rootKey: string;
  store: ConversationSessions;
  isVisible: () => boolean;
  services: Pick<AiFeatureServices, 'dailyReport' | 'sendRagMessage'>;
}) {
  const { canonical, rootKey, store } = input;
  const latest = useRef(input);
  latest.current = input;
  useEffect(() => {
    if (!canonical) return;
    const rendezvous = dailyReminderPromptRendezvous(store);
    const detach = mountDailyReminderConversationPrompt(
      store,
      rootKey,
      () => latest.current.canonical === true && latest.current.isVisible(),
      () =>
        latest.current.services.dailyReport
          ? latest.current.services.sendRagMessage
          : undefined,
    );
    const unsubscribe = store.subscribe(rendezvous.drain);
    return () => {
      unsubscribe();
      detach();
    };
  }, [canonical, rootKey, store]);
  useEffect(() => {
    if (canonical) dailyReminderPromptRendezvous(store).drain();
  });
  return () => {
    const { services, isVisible } = latest.current;
    if (services.dailyReport)
      startConversationReportTurn(store, isVisible, services.sendRagMessage);
  };
}
