import type { DailyReportIdentity } from '@orot/domain';
import type { ConversationEntryContext } from './conversationIntent';
import type { createDailyReportFeature } from './dailyReportFeature';

type Target = NonNullable<ConversationEntryContext['dailyReport']>;

/** Retain only the exact committed result if it is still the active saved revision. */
export async function retainDailyReportResult(
  feature: ReturnType<typeof createDailyReportFeature>,
  identity: DailyReportIdentity,
  runId: string,
  retain?: (target: Target) => Promise<void>,
) {
  if (!retain) return true;
  const current = await feature.lookup(identity);
  if (current.status !== 'saved' || current.runId !== runId) return false;
  await retain({ identity, runId, revision: current.revision });
  return true;
}
