import { act, render, waitFor } from '@testing-library/react-native';
import { useSyncExternalStore } from 'react';
import { createConversationSessions } from '../conversationSessions';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import {
  useConversationEntryIntent,
  conversationEntryForSession,
} from '../useConversationEntryIntent';
import { conversationIntentRequests } from '../../aiFeatures/integration/conversationIntent';

const context = {
  entryKey: 'synthetic-entry',
  intent: 'health-summary' as const,
};
/** Actual attachment publishes one restoring id before source-checked restoration settles. */
test('same-id restoration completion applies the original entry intent exactly once', async () => {
  const f = await healthContextFixture();
  const storage = createConversationArtifactStorage(f.database);
  let finish!: () => void;
  const store = createConversationSessions({
    continuousSession: async signal => ({
      ...(await storage.continuousSession(
        { providerId: 'synthetic', modelId: 'model' },
        'continuous',
        '2026-11-16T00:00:00.000Z',
        signal,
      )),
      model: { providerId: 'synthetic', modelId: 'model' },
    }),
    retention: createConversationSessionRetention({
      openStorage: async () => storage,
      createId: () => 'unused',
      now: () => '2026-11-16T00:00:00.000Z',
    }),
    restoreSession: async () => {
      await new Promise<void>(resolve => {
        finish = resolve;
      });
      return [];
    },
  });
  function Entry() {
    const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const session = snapshot.sessions.find(s => s.id === snapshot.activeId)!;
    useConversationEntryIntent(
      store,
      context,
      session.id,
      Boolean(
        session.restoring ||
        session.modelSelectionPending ||
        session.restoreFailed ||
        session.modelSelectionFailed,
      ),
    );
    return null;
  }
  try {
    let work!: Promise<void>;
    await act(async () => {
      work = store.synchronizeModel();
    });
    await render(<Entry />);
    await waitFor(() => expect(finish).toBeDefined());
    const id = store.getSnapshot().activeId;
    expect(conversationEntryForSession(store, id)).toBeUndefined();
    await act(async () => {
      finish();
      await work;
    });
    expect(store.getSnapshot().activeId).toBe(id);
    expect(conversationEntryForSession(store, id)).toEqual(context);
    expect(
      store.getSnapshot().sessions.find(s => s.id === id)!.entryPrompt,
    ).toBe(conversationIntentRequests['health-summary']);
  } finally {
    store.dispose();
    f.close();
  }
});
