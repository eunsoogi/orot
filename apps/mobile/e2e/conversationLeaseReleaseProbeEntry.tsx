import '../src/agent/polyfills';
import { useState } from 'react';
import {
  AppRegistry,
  Button,
  NativeModules,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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
import { runSyntheticStages } from './conversationLeaseProbeStage';

// This opt-in test entry uses the app's protected database; only synthetic values enter its counter.
const options = createConversationSessionOptions({
  loadLocalData: openAiFeatureLocalData,
  registry: new LocalEvidenceReferenceRegistry(),
});
let release: (() => void) | undefined;
let publish: ((value: string) => void) | undefined;
let publishStage: ((value: string) => void) | undefined;
let observedRequestId: string | undefined;
const nativeExecution = NativeModules.ConversationExecutionModule as {
  isActive(id: string): Promise<boolean>;
};
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
const send: ConversationSender = async (question, _history, signal, observer) =>
  runSyntheticStages(
    value => publishStage?.(value),
    async mark => {
      mark('database');
      const db = await database();
      await db.execute(
        'INSERT INTO conversation_retention_probe_dispatches DEFAULT VALUES',
      );
      mark('preview-boundary');
      const boundary = await observer!.onPreviewBoundary!();
      mark('preview-prepare');
      await observer!.onPreviewPrepared!(boundary, {
        providerId: 'synthetic',
        modelId: 'synthetic',
        sources: [],
      });
      mark('preview-stream');
      observer!.onTaskStreamEvent!({ type: 'started' });
      observer!.onTaskStreamEvent!({ type: 'text_delta', text: partial });
      mark('request-identity');
      const requests = (
        await db.execute(
          "SELECT id FROM conversation_requests WHERE question = ? AND status = 'active'",
          [question],
        )
      ).rows;
      if (
        requests.length !== 1 ||
        typeof requests[0]?.id !== 'string' ||
        !nativeExecution?.isActive
      )
        throw new Error('Unique native request identity unavailable.');
      observedRequestId = requests[0].id;
      mark('lease-check');
      if (!(await nativeExecution.isActive(observedRequestId)))
        throw new Error('Native execution lease was not acquired.');
      const waiting = new Promise<void>(resolve => {
        release = resolve;
        signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      mark('probe-read');
      publish?.(await readProbe());
      mark('await-release');
      await waiting;
      release = undefined;
      if (signal?.aborted) return { status: 'failure', kind: 'cancelled' };
      if (question === 'Synthetic failure question')
        return { status: 'failure', kind: 'provider_refused' };
      mark('commit-candidate');
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
    },
  );

/** Counts and checkpoint state expose no health data and survive the test process restart. */
async function readProbe() {
  await options.listSessions?.();
  const db = await database();
  const rows = await db.execute(
    "SELECT (SELECT COUNT(*) FROM conversation_retention_probe_dispatches) AS dispatches, (SELECT COUNT(*) FROM conversation_completions) AS completions, (SELECT COUNT(*) FROM conversation_request_previews WHERE body = ?) AS previews, (SELECT COUNT(*) FROM conversation_requests WHERE status = 'interrupted') AS interrupted",
    [partial],
  );
  const row = rows.rows[0];
  // Query the exact request whose native lease was observed active before settlement.
  const lease = observedRequestId
    ? (await nativeExecution.isActive(observedRequestId))
      ? 'active'
      : 'released'
    : 'unknown';
  return `dispatches:${row.dispatches} completions:${row.completions} previews:${row.previews} interrupted:${row.interrupted} lease:${lease}`;
}

/** Observe the real lease after terminal UI without treating elapsed time as completion. */
async function waitForLeaseRelease() {
  const requestId = observedRequestId;
  if (!requestId) throw new Error('Observed request identity unavailable.');
  while (await nativeExecution.isActive(requestId)) {
    if (observedRequestId !== requestId)
      throw new Error('Observed request identity changed.');
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
  if (observedRequestId !== requestId)
    throw new Error('Observed request identity changed.');
  return readProbe();
}

function Probe() {
  const [otherTab, setOtherTab] = useState(false);
  const [controller] = useState(() =>
    createNavigationController<'conversation' | 'history'>('conversation'),
  );
  const [status, setStatus] = useState('unread');
  const [stage, setStage] = useState('stage:not-entered result:unavailable');
  publish = setStatus;
  publishStage = setStage;
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
                  testID="retention-probe-await-release"
                  title="Lease"
                  onPress={() => {
                    waitForLeaseRelease()
                      .then(setStatus)
                      .catch(() => setStatus('lease-observation-failed'));
                  }}
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
            <Text
              testID="retention-probe-status"
              accessibilityLabel={`${stage} ${status}`}
            >
              {status}
            </Text>
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
