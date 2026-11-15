import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { useConversationSessions } from '../ragConversation/ConversationSessionsContext';
import { requestConversationReport } from '../ragConversation/requestConversationReport';
import { t } from '../i18n';

/** Retain report preparation in the shared session without redirecting a newer screen. */
export function useOverviewReportEntry(
  active: boolean,
  openConversation: () => void,
) {
  const store = useConversationSessions();
  const current = useRef(false);
  current.current = active;
  useEffect(
    () => () => {
      current.current = false;
    },
    [],
  );
  return () => {
    requestConversationReport(
      store,
      () => current.current,
      openConversation,
    ).then(result => {
      // Show storage failures at the entry point, not only inside the hidden conversation.
      if (result === 'failed' && current.current)
        Alert.alert(t('dailyReport.title'), t('dailyReport.entryError'));
    });
  };
}
