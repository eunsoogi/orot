/** Preserve chronological turn order when answers, tool events and requests are restored separately. */
export function orderRestoredConversationTurns<
  T extends { toolMessageId: string },
>(restored: T[], times: ReadonlyMap<string, string>): T[] {
  return restored.sort(
    (a, b) =>
      times.get(a.toolMessageId)!.localeCompare(times.get(b.toolMessageId)!) ||
      a.toolMessageId.localeCompare(b.toolMessageId),
  );
}
