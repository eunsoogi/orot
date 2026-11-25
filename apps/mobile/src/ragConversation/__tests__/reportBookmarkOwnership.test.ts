import { AppState } from 'react-native';
import { createConversationSessions } from '../conversationSessions';
import { captureReportBookmarkOwner } from '../reportBookmarkOwnership';

test('editing and restoring the typed request cannot revive a report bookmark', () => {
  const original = AppState.currentState;
  AppState.currentState = 'active';
  const store = createConversationSessions();
  const id = store.getSnapshot().activeId;
  const lease = jest.spyOn(store, 'savedReportLease').mockReturnValue({
    id: 'synthetic-session',
    version: 0,
  });
  store.setDraft(id, 'Synthetic bookmark request.');
  const owner = captureReportBookmarkOwner({ store, sessionId: id });
  try {
    expect(owner.current()).toBe(true);
    store.setDraft(id, 'Different draft.');
    store.setDraft(id, 'Synthetic bookmark request.');
    expect(owner.current()).toBe(false);
  } finally {
    owner.close();
    lease.mockRestore();
    store.dispose();
    AppState.currentState = original;
  }
});
