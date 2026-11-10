import { createDailyReportService } from './dailyReportService';

/** The app uses the same encrypted database as its other local AI services. */
export async function openDailyReportService(
  input: Omit<Parameters<typeof createDailyReportService>[0], 'database'>,
) {
  const { openLocalAgentMemoryDatabase } =
    await import('../../storage/secureDatabase');
  return createDailyReportService({
    ...input,
    database: await openLocalAgentMemoryDatabase(),
  });
}
