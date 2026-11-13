import { notifyLocalDataCleared } from '../../storage/localDataClearEvents';
import { createConversationPhotoDrafts } from '../conversationPhotoDraft';
import { observeConversationPhotoDeletion } from '../conversationPhotoDeletion';

test('local-data deletion hides staged photos immediately and retires their files', async () => {
  const photo = { id: 'synthetic' };
  const discard = jest.fn().mockResolvedValue(undefined);
  const drafts = createConversationPhotoDrafts({
    pick: async () => photo,
    discard,
  });
  await drafts.select(1);
  const unsubscribe = observeConversationPhotoDeletion(drafts);
  try {
    notifyLocalDataCleared();
    expect(drafts.get(1)).toEqual({ status: 'empty' });
    await drafts.clear();
    expect(discard).toHaveBeenCalledWith(photo);
  } finally {
    unsubscribe();
  }
});

test('committed deletion is not undone when photo cleanup fails', async () => {
  const drafts = createConversationPhotoDrafts({
    pick: async () => ({ id: 'synthetic' }),
    discard: jest.fn().mockRejectedValue(new Error('cleanup failed')),
  });
  await drafts.select(1);
  const unsubscribe = observeConversationPhotoDeletion(drafts);
  try {
    notifyLocalDataCleared();
    await expect(drafts.clear()).rejects.toThrow('cleanup failed');
    expect(drafts.get(1)).toEqual({ status: 'empty' });
    expect(drafts.cleanupPending(1)).toBe(true);
  } finally {
    unsubscribe();
  }
});
