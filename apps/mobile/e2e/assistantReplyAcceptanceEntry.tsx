import { useEffect, useRef, useState } from 'react';
import {
  AppRegistry,
  AppState,
  NativeModules,
  Pressable,
  Text,
  View,
} from 'react-native';
import { name as appName } from '../app.json';
import App from '../App';
import { openLocalAgentMemoryDatabase } from '../src/storage/secureDatabase';
import { createConversationArtifactStorage } from '../src/storage/conversationArtifactStorage';
import { createReplyNotificationStorage } from '../src/replyNotifications/replyNotificationStorage';
import { nativeReplyNotifications } from '../src/replyNotifications/nativeReplyNotifications';

/** Reserve a synthetic request; commit only after backgrounding so production eligibility is exercised. */
async function prepare() {
  const database = await openLocalAgentMemoryDatabase();
  const storage = createReplyNotificationStorage(
    createConversationArtifactStorage(database),
    database,
  );
  const sessionId = 'synthetic-native-reply-session';
  const requestId = 'synthetic-native-reply-request';
  const createdAt = '2026-01-01T00:00:00.000Z';
  const sessionVersion = await storage.createSession(
    sessionId,
    await storage.currentGeneration(),
  );
  await storage.startRequest({
    id: requestId,
    sessionId,
    sessionVersion,
    question: 'Synthetic question',
    createdAt,
  });
  const bridge = NativeModules.OrotTestControl as {
    enqueueSyntheticReply(input: {
      requestId: string;
      sessionId: string;
      messageId: string;
      sessionVersion: number;
    }): Promise<void>;
  };
  let rejected = false;
  try {
    await bridge.enqueueSyntheticReply({
      requestId,
      sessionId: 'not-the-reserved-session',
      messageId: requestId,
      sessionVersion,
    });
  } catch (error) {
    if ((error as { code?: unknown }).code !== 'INVALID_FIXTURE') throw error;
    rejected = true;
  }
  if (!rejected || (await nativeReplyNotifications().consumeTarget()) != null)
    throw new Error('Invalid synthetic identity was admitted.');
  return () =>
    storage.append({
      id: requestId,
      sessionId,
      question: 'Synthetic question',
      createdAt,
      providerId: 'synthetic',
      modelId: 'synthetic',
      status: 'complete',
      answer: 'Synthetic retained reply',
      sources: [],
      citations: [],
    });
}

function AssistantReplyAcceptanceApp() {
  const [state, setState] = useState<
    'preparing' | 'enable' | 'ready' | 'failed'
  >('preparing');
  const commit = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    let current = true;
    prepare().then(
      append => {
        if (current) {
          commit.current = append;
          setState('enable');
        }
      },
      () => {
        if (current) setState('failed');
      },
    );
    return () => {
      current = false;
    };
  }, []);
  async function enable() {
    try {
      const result = await nativeReplyNotifications().save({
        enabled: true,
        preview: true,
      });
      if (result !== 'authorized') throw new Error('Notifications unavailable');
      // Commit once, on the first real background transition; do not synthesize an inbox tap.
      const listener = AppState.addEventListener('change', next => {
        if (next !== 'background' || !commit.current) return;
        const append = commit.current;
        commit.current = null;
        listener.remove();
        append().catch(() => undefined);
      });
      setState('ready');
    } catch {
      setState('failed');
    }
  }
  if (state === 'ready') return <App />;
  return (
    <View>
      <Text testID="assistant-reply-fixture-state">{state}</Text>
      {state === 'enable' ? (
        <Pressable
          accessibilityRole="button"
          testID="assistant-reply-enable"
          onPress={enable}
        >
          <Text>Enable synthetic reply notification</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

AppRegistry.registerComponent(appName, () => AssistantReplyAcceptanceApp);
