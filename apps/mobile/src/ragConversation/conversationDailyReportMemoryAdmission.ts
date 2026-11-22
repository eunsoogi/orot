import type { DailyReportMemoryTap } from '../storage/dailyReportMemoryTap';
import { createConversationRetainedPreview } from './conversationRetainedPreview';
import type { ConversationTurnRetentionInput } from './conversationTurnRetentionInput';
import type { ConversationRetentionCandidate } from './conversationRetention';

/** The optional report pointer uses only the immutable live turn identity. */
export function conversationDailyReportMemoryAdmission(
  input: ConversationTurnRetentionInput,
) {
  return {
    ...createConversationRetainedPreview(input),
    admitDailyReportMemory(tap: DailyReportMemoryTap) {
      const {
        admitAutomaticDailyReportMemory: admit,
        bookmarkCompletedDailyReport: bookmark,
      } = input.storage;
      if (input.restored || !admit || !bookmark) return undefined;
      const owner = {
        artifactId: input.turnId,
        lease: { id: input.sessionId, version: input.sessionVersion ?? 0 },
      };
      const token = admit(owner, tap);
      return token
        ? (
            report: NonNullable<ConversationRetentionCandidate['dailyReport']>,
            current: () => boolean,
          ) =>
            bookmark(
              { ...owner, current },
              { token, runId: report.runId, revision: report.revision },
            )
        : undefined;
    },
  };
}
