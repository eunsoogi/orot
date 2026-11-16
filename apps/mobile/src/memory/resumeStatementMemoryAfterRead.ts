/** Optional local maintenance starts only after a current successful Memory read.
 * Recheck the read owner after module/database awaits; its deletion/background
 * invalidation may happen before the scheduler admits any source processing. */
export function resumeStatementMemoryAfterRead(isCurrent: () => boolean) {
  setTimeout(() => {
    if (!isCurrent()) return;
    (async () => {
      const [{ openLocalAgentMemoryDatabase }, { scheduleStatementMemory }] =
        await Promise.all([
          import('../storage/secureDatabase'),
          import('./scheduleStatementMemory'),
        ]);
      if (!isCurrent()) return;
      const database = await openLocalAgentMemoryDatabase();
      if (isCurrent()) await scheduleStatementMemory(database, isCurrent);
    })().catch(() => {}); // Failure retains original records and pending work.
  }, 0);
}
