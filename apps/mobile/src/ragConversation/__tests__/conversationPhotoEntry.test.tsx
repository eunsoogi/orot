import { renderHook } from '@testing-library/react-native';
import { createConversationSessions } from '../conversationSessions';
import { useConversationEntryIntent } from '../useConversationEntryIntent';

jest.mock('../../medicalDocuments/medicalDocumentImportService', () => ({
  medicalDocumentImportService: {
    selectDocument: jest
      .fn()
      .mockResolvedValue({
        id: 'synthetic',
        displayName: 'synthetic.jpg',
        contentHash: `sha256:${'a'.repeat(64)}`,
        sections: [],
      }),
    discardDocument: jest.fn().mockResolvedValue(undefined),
  },
}));

test('a specialized route leaves the app-owned photo-only draft in its original session', async () => {
  const store = createConversationSessions();
  const original = store.getSnapshot().activeId;
  await store.photoDrafts.select(original);
  expect(store.photoDrafts.get(original).status).toBe('ready');
  await renderHook(() =>
    useConversationEntryIntent(store, {
      intent: 'health-summary',
      entryKey: 'route',
    }),
  );
  expect(store.getSnapshot().activeId).not.toBe(original);
  expect(store.photoDrafts.get(original).status).toBe('ready');
  expect(store.photoDrafts.get(store.getSnapshot().activeId).status).toBe(
    'empty',
  );
  store.dispose();
});
