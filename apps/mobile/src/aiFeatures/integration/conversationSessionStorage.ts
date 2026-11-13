import type { AiFeatureLocalData } from './localData';

/** Recover interrupted work once before this app owner can dispatch a new request. */
export function createConversationSessionStorage(
  loadLocalData: () => Promise<AiFeatureLocalData>,
) {
  let recovered: Promise<void> | undefined;
  return async () => {
    const data = await loadLocalData();
    if (!data.openConversationArtifactStorage)
      throw new Error('Conversation storage is unavailable.');
    const storage = await data.openConversationArtifactStorage();
    await (recovered ??= (async () => {
      await storage.recoverInterruptedToolEvents();
      await storage.interruptRecoveredRequests();
    })().catch(error => {
      recovered = undefined;
      throw error;
    }));
    return storage;
  };
}
