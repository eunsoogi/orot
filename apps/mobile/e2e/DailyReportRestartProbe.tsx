import { useEffect, useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';
import { ConversationScreen } from '../src/ragConversation/ConversationScreen';
import {
  ConversationSessionsProvider,
  useConversationSessions,
} from '../src/ragConversation/ConversationSessionsContext';
import { setConversationEntryForSession } from '../src/ragConversation/useConversationEntryIntent';
import { entryIntentSender } from '../src/ragConversation/entryIntentSender';
import type { createDailyReportRestartSession } from './dailyReportRestartSession';

type Session = Awaited<ReturnType<typeof createDailyReportRestartSession>>;
/** Native assertions operate the real interruption card and Alert, not a copied retry button. */
export function DailyReportRestartProbe({ session }: { session: Session }) {
  return (
    <ConversationSessionsProvider options={session.options}>
      <Content session={session} />
    </ConversationSessionsProvider>
  );
}
function Content({ session }: { session: Session }) {
  const store = useConversationSessions();
  const [snapshot, setSnapshot] = useState(session.snapshot);
  const [started, setStarted] = useState(false);
  const [visible, setVisible] = useState(true);
  useEffect(
    () => session.subscribe(() => setSnapshot(session.snapshot())),
    [session],
  );
  const start = () => {
    if (started) return;
    setStarted(true);
    const id = store.getSnapshot().activeId;
    // Register before the original dispatch and leave the failed turn's intent on its owner.
    setConversationEntryForSession(store, id, {
      intent: 'daily-report',
      entryKey: 'synthetic-daily-restart',
      reportRequest: session.identity,
    });
    store.setDraft(id, '합성 일일보고서');
    store.send(id, entryIntentSender(store, id, session.onSend));
  };
  const leave = () => {
    store.cancel(store.getSnapshot().activeId);
    setVisible(false);
  };
  return (
    <View style={styles.root}>
      <Text testID="daily-restart-status">{JSON.stringify(snapshot)}</Text>
      {!started ? (
        <Button title="Start synthetic report" onPress={start} />
      ) : null}
      {snapshot.waiting ? (
        <Button title="Interrupt synthetic model" onPress={session.interrupt} />
      ) : null}
      <Button title="Select next synthetic day" onPress={session.nextDay} />
      <Button title="Leave synthetic route" onPress={leave} />
      {visible ? (
        <ConversationScreen
          onBack={leave}
          onOpenSource={() => {}}
          onSend={session.onSend}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
