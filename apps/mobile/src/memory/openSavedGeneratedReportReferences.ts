export async function openSavedGeneratedReportReferences() {
  const [
    { openLocalAgentMemoryDatabase },
    { createConversationArtifactStorage },
  ] = await Promise.all([
    import('../storage/secureDatabase'),
    import('../storage/conversationArtifactStorage'),
  ]);
  return createConversationArtifactStorage(
    await openLocalAgentMemoryDatabase(),
  );
}
