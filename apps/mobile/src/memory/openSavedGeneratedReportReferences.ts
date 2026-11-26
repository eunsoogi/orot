export async function openSavedGeneratedReportReferences() {
  const [
    { openLocalAgentMemoryDatabase, isCurrentLocalAgentMemoryDatabase },
    { createConversationArtifactStorage },
  ] = await Promise.all([
    import('../storage/secureDatabase'),
    import('../storage/conversationArtifactStorage'),
  ]);
  const database = await openLocalAgentMemoryDatabase();
  const storage = createConversationArtifactStorage(database);
  // Cold previews cannot be carried to a replacement encrypted database,
  // even if it reports an identical session/turn ID after a restore.
  const owned = (current: () => boolean) => () =>
    isCurrentLocalAgentMemoryDatabase(database) && current();
  return {
    ...storage,
    bookmarkDailyReport: (
      input: Parameters<typeof storage.bookmarkDailyReport>[0],
    ) =>
      storage.bookmarkDailyReport({
        ...input,
        current: input.confirmArchivedProtection
          ? owned(input.current)
          : input.current,
      }),
    bookmarkHealthSummary: (
      input: Parameters<typeof storage.bookmarkHealthSummary>[0],
    ) =>
      storage.bookmarkHealthSummary({
        ...input,
        current: input.archive ? owned(input.current) : input.current,
      }),
    readArchivedVisitBookmarkPreview: (
      input: Parameters<typeof storage.readArchivedVisitBookmarkPreview>[0],
    ) =>
      storage.readArchivedVisitBookmarkPreview({
        ...input,
        current: owned(input.current),
      }),
    bookmarkArchivedVisitQuestions: (
      input: Parameters<typeof storage.bookmarkArchivedVisitQuestions>[0],
    ) =>
      storage.bookmarkArchivedVisitQuestions({
        ...input,
        current: owned(input.current),
      }),
  };
}
