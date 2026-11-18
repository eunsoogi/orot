import { createConversationSessions } from '../conversationSessions';
import { setup } from '../testSupport/continuousSessionFixture';
import { conversationHistoryRecoveryProps } from '../conversationHistoryRecoveryProps';

/** Real canonical attachment crosses selection and restore phases without borrowing send activity. */
test('initial canonical resolution and protected restore are busy, attached model refresh is not', async () => {
  const f = await setup();
  const original = f.options.continuousSession;
  let select!: () => void;
  let restore!: () => void;
  f.options.continuousSession = async signal => {
    await new Promise<void>(resolve => {
      select = resolve;
    });
    return original(signal);
  };
  f.options.restoreSession = async () => {
    await new Promise<void>(resolve => {
      restore = resolve;
    });
    return [];
  };
  const store = createConversationSessions(f.options);
  const state = () => {
    const snapshot = store.getSnapshot();
    return conversationHistoryRecoveryProps(
      snapshot.sessions.find(s => s.id === snapshot.activeId)!,
      store,
    );
  };
  try {
    expect(state().restoringHistory).toBe(false);
    const work = store.synchronizeModel();
    expect(state().restoringHistory).toBe(true);
    select();
    for (let i = 0; i < 100 && !restore; i++)
      await new Promise(resolve => setTimeout(resolve, 0));
    expect(restore).toBeDefined();
    expect(state().restoringHistory).toBe(true);
    restore();
    await work;
    expect(state().restoringHistory).toBe(false);
    const refresh = store.synchronizeModel(true);
    expect(state().restoringHistory).toBe(false);
    select();
    await refresh;
    expect(state().restoringHistory).toBe(false);
  } finally {
    store.dispose();
    f.store.dispose();
    f.close();
  }
});
