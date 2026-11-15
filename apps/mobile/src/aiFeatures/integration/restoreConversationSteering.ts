import type { createConversationSessionStorage } from './conversationSessionStorage';

/** Display restoration is separate from the live execution/steering owner. */
export function restoreConversationSteering(
  open: ReturnType<typeof createConversationSessionStorage>,
) {
  return async (sessionId: string, requestId: string, signal: AbortSignal) => {
    const storage = await open();
    const version = await storage.activeSessionVersion(sessionId);
    return version === null
      ? []
      : storage.readSteeringHistory(sessionId, version, requestId, signal);
  };
}
