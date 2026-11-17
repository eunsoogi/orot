/** Coordinates contain no transcript and remain inside the existing protected local database. */
export async function openConversationReadingPosition() {
  const [
    { openLocalAgentMemoryDatabase },
    { createConversationReadingPositionStorage },
  ] = await Promise.all([
    import('../storage/secureDatabase'),
    import('../storage/conversationReadingPositionStorage'),
  ]);
  return createConversationReadingPositionStorage(
    await openLocalAgentMemoryDatabase(),
  );
}
