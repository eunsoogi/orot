import { useEffect, useState } from 'react';
import { AppRegistry, NativeModules, Text } from 'react-native';
import { name as appName } from '../app.json';
import App from '../App';
import { openLocalAgentMemoryDatabase } from '../src/storage/secureDatabase';
import { createConversationArtifactStorage } from '../src/storage/conversationArtifactStorage';
import { nativeReplyNotifications } from '../src/replyNotifications/nativeReplyNotifications';

/** Seed a synthetic committed answer through the real protected storage adapter. */
async function prepare() {
  const database = await openLocalAgentMemoryDatabase();
  const storage = createConversationArtifactStorage(database);
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
  await storage.append({
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
  const saved = await storage.read(requestId);
  const completions = await storage.listCompletionIdentities();
  if (
    saved?.answer !== 'Synthetic retained reply' ||
    !Array.isArray(saved.citations) ||
    !completions.some(
      item =>
        item.requestId === requestId &&
        item.sessionId === sessionId &&
        item.messageId === requestId &&
        item.sessionVersion === sessionVersion,
    )
  )
    throw new Error('The synthetic reply was not durably prepared.');
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
  if (!rejected) throw new Error('The invalid synthetic reply was admitted.');
  // Rejection must leave the production inbox empty before any valid request is enqueued.
  if ((await nativeReplyNotifications().consumeTarget()) != null)
    throw new Error('The invalid synthetic reply mutated the inbox.');
  await bridge.enqueueSyntheticReply({
    requestId,
    sessionId,
    messageId: requestId,
    sessionVersion,
  });
}

function AssistantReplyAcceptanceApp() {
  const [state, setState] = useState<'preparing' | 'ready' | 'failed'>(
    'preparing',
  );
  useEffect(() => {
    let current = true;
    prepare().then(
      () => {
        if (current) setState('ready');
      },
      () => {
        if (current) setState('failed');
      },
    );
    return () => {
      current = false;
    };
  }, []);
  if (state === 'ready') return <App />;
  return <Text testID="assistant-reply-fixture-state">{state}</Text>;
}

// The production gate and delivery observer mount only after the real inbox contains the synthetic tap.
AppRegistry.registerComponent(appName, () => AssistantReplyAcceptanceApp);
