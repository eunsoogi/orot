import '../src/agent/polyfills';
import { useState } from 'react';
import { AppRegistry, Button, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { name as appName } from '../app.json';
import { ConversationScreen } from '../src/ragConversation/ConversationScreen';
import { ConversationHistoryScreen } from '../src/ragConversation/ConversationHistoryScreen';
import { ConversationSessionsProvider } from '../src/ragConversation/ConversationSessionsContext';
import { createConversationSessionOptions } from '../src/aiFeatures/integration/conversationSessionOptions';
import { openAiFeatureLocalData } from '../src/aiFeatures/integration/localData';
import { LocalEvidenceReferenceRegistry } from '../src/aiFeatures/integration/evidenceRegistry';
import { openLocalAgentMemoryDatabase } from '../src/storage/secureDatabase';
import { NavigationRouteAdapter } from '../src/navigation/NavigationRouteAdapter';
import { createNavigationController } from '../src/navigation/navigationController';
import type { ConversationSender } from '../src/ragConversation/conversationSessionTypes';

// This opt-in test entry uses the app's protected database; only synthetic values enter its counter.
const options = createConversationSessionOptions({
  loadLocalData: openAiFeatureLocalData,
  registry: new LocalEvidenceReferenceRegistry(),
});
let release: (() => void) | undefined;
let publish: ((value: string) => void) | undefined;
const partial = 'Synthetic partial response';
const answer = 'Synthetic committed response';

async function database() {
  const db = await openLocalAgentMemoryDatabase();
  await db.execute(
    'CREATE TABLE IF NOT EXISTS conversation_retention_probe_dispatches (id INTEGER PRIMARY KEY AUTOINCREMENT)',
  );
  return db;
}

/** A controllable sender exercises the actual session owner and encrypted request store. */
const send: ConversationSender = async (
  question,
  _history,
  signal,
  observer,
) => {
  const db = await database();
  await db.execute(
    'INSERT INTO conversation_retention_probe_dispatches DEFAULT VALUES',
  );
  const boundary = await observer!.onPreviewBoundary!();
  await observer!.onPreviewPrepared!(boundary, {
    providerId: 'synthetic',
    modelId: 'synthetic',
    sources: [],
  });
  observer!.onTaskStreamEvent!({ type: 'started' });
  observer!.onTaskStreamEvent!({ type: 'text_delta', text: partial });
  await new Promise<void>(resolve => {
    release = resolve;
    signal?.addEventListener('abort', () => resolve(), { once: true });
  });
  release = undefined;
  if (signal?.aborted) return { status: 'failure', kind: 'cancelled' };
  await observer!.onRetentionCandidate!(
    {
      question,
      answer,
      providerId: 'synthetic',
      modelId: 'synthetic',
      sources: [],
      citations: [],
    },
    signal!,
  );
  publish?.(await readProbe());
  return { status: 'answer', answer, citations: [] };
};

/** Counts and checkpoint state expose no health data and survive the test process restart. */
async function readProbe() {
  await options.listSessions?.();
  const db = await database();
  const rows = await db.execute(
    "SELECT (SELECT COUNT(*) FROM conversation_retention_probe_dispatches) AS dispatches, (SELECT COUNT(*) FROM conversation_completions) AS completions, (SELECT COUNT(*) FROM conversation_request_previews WHERE body = ?) AS previews, (SELECT COUNT(*) FROM conversation_requests WHERE status = 'interrupted') AS interrupted",
    [partial],
  );
  const row = rows.rows[0];
  return `dispatches:${row.dispatches} completions:${row.completions} previews:${row.previews} interrupted:${row.interrupted}`;
}

function Probe() {
  const [otherTab, setOtherTab] = useState(false);
  const [controller] = useState(() =>
    createNavigationController<'conversation' | 'history'>('conversation'),
  );
  const [status, setStatus] = useState('unread');
  publish = setStatus;
  return (
    <SafeAreaProvider>
      <ConversationSessionsProvider options={options}>
        <View style={styles.root}>
          <SafeAreaView edges={['top']}>
            <View style={styles.controls}>
              <View style={styles.control}>
                <Button
                  testID="retention-probe-tab"
                  title={otherTab ? 'Return' : 'Tab'}
                  onPress={() => setOtherTab(value => !value)}
                />
              </View>
              <View style={styles.control}>
                <Button
                  testID="retention-probe-release"
                  title="Finish"
                  onPress={() => release?.()}
                />
              </View>
              <View style={styles.control}>
                <Button
                  testID="retention-probe-refresh"
                  title="Read"
                  onPress={() => {
                    readProbe()
                      .then(setStatus)
                      .catch(() => setStatus('unavailable'));
                  }}
                />
              </View>
            </View>
            <Text testID="retention-probe-status">{status}</Text>
          </SafeAreaView>
          {otherTab ? (
            <Text testID="retention-probe-other-tab">Other test tab</Text>
          ) : (
            <NavigationRouteAdapter
              controller={controller}
              leaveState={{
                readState: () => ({
                  hasUnsavedChanges: false,
                  isRecording: false,
                  hasOngoingOperation: false,
                  revision: 0,
                  inputRevision: 0,
                }),
              }}
              showHome
            >
              {navigation =>
                navigation.route.name === 'history' ? (
                  <ConversationHistoryScreen onBack={navigation.onBack} />
                ) : (
                  <ConversationScreen
                    navigationRouteKey={navigation.route.key}
                    onBack={navigation.onBack}
                    onOpenHistory={() => navigation.push('history')}
                    onOpenSource={() => {}}
                    onSend={send}
                  />
                )
              }
            </NavigationRouteAdapter>
          )}
        </View>
      </ConversationSessionsProvider>
    </SafeAreaProvider>
  );
}

AppRegistry.registerComponent(appName, () => Probe);

const styles = StyleSheet.create({
  root: { flex: 1 },
  controls: { flexDirection: 'row', justifyContent: 'space-around' },
  control: { minWidth: 44, minHeight: 44, justifyContent: 'center' },
});
