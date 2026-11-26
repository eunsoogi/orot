/** Lazily open the protected local database used by the Daily Report. */
export async function openDailyReportDatabase() {
  const { openLocalAgentMemoryDatabase } =
    await import('../../storage/secureDatabase');
  return openLocalAgentMemoryDatabase();
}
