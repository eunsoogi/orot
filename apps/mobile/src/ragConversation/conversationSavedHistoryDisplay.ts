import type { ArchivedConversationPresentationMetadata } from '../storage/archivedConversationPresentationMetadata';
import type { ConversationHistoryCursor } from './conversationHistoryPage';
import type { DisplayMessage } from './conversationDisplayMessage';
import type { ConversationSession } from './conversationSessionTypes';
import { t } from '../i18n';
import type { ConversationRecoveryReason } from './conversationExecutionLease';
import type { RetainedConversationTask } from './conversationTaskState';
import type { SavedArchivedCitation } from './savedArchivedCitations';

/** Persisted history is display-only, including explicitly incomplete state. */
export type SavedHistoryDisplayRow = {
  readonly id: string;
  readonly createdAt: string;
} & (
  | (ArchivedConversationPresentationMetadata & {
      readonly kind: 'answer';
      readonly question: string;
      readonly answer: string;
      readonly directPhoto?: true;
      readonly archivedCitationTarget?: import('./useArchivedCitationOpen').ArchivedCitationTarget;
      readonly interruptionReason?: ConversationRecoveryReason;
      readonly partial?: true;
      readonly healthSummary?: NonNullable<DisplayMessage['healthSummary']>;
      readonly dailyReport?: NonNullable<DisplayMessage['dailyReport']>;
      readonly savedCitations?: readonly SavedArchivedCitation[];
      readonly steeringInstructions?: DisplayMessage['steeringInstructions'];
    })
  | {
      readonly kind: 'interrupted';
      readonly question: string;
      readonly interruptionReason?: ConversationRecoveryReason;
    }
);

export type ReadSavedHistoryDisplay = (
  sessionId: string,
  version: number,
  signal: AbortSignal,
  cursor?: ConversationHistoryCursor,
) => Promise<{
  readonly rows: readonly SavedHistoryDisplayRow[];
  readonly nextCursor: ConversationHistoryCursor | null;
  readonly taskCards?: readonly RetainedConversationTask[];
}>;

export type SavedHistoryDisplayItem = {
  readonly row: SavedHistoryDisplayRow;
  readonly questionId: number;
  readonly answerId: number;
  /** Mount-only ordering for a newly saved local photo among current live turns. */
  readonly afterLiveId?: number;
};

/** Keep row identity through older prepends and never replace an already mounted live turn. */
export function prependSavedHistoryDisplay(
  rows: readonly SavedHistoryDisplayRow[],
  existing: readonly SavedHistoryDisplayItem[],
  nextId: () => number,
) {
  const ids = new Set(existing.map(item => item.row.id));
  const added: SavedHistoryDisplayItem[] = [];
  for (const row of rows) {
    if (ids.has(row.id)) continue;
    ids.add(row.id);
    added.push({ row, questionId: nextId(), answerId: nextId() });
  }
  return [...added, ...existing];
}

/** Adapt only inside the transcript view, never in the send-context or canonical session stores. */
export function savedHistoryTranscript(
  saved: readonly SavedHistoryDisplayItem[],
  live: readonly DisplayMessage[],
): readonly DisplayMessage[] {
  if (!saved.length) return live;
  const liveIds = new Set(live.map(message => message.toolMessageId));
  const historical: DisplayMessage[] = [];
  const mounted: { after: number; messages: DisplayMessage[] }[] = [];
  for (const { row, questionId, answerId, afterLiveId } of saved) {
    if (liveIds.has(row.id)) continue;
    const origin = {
      restoredHistory: true as const,
      savedHistoryDisplayOnly: true as const,
      voiceTimelineOrder: { createdAt: row.createdAt, id: row.id },
    };
    const incomplete = row.kind === 'interrupted' || row.partial;
    const activity = incomplete
      ? row.interruptionReason
        ? t(`conversationInterruption.${row.interruptionReason}`)
        : t('ragConversation.progressInterrupted')
      : undefined;
    const directPhoto = row.kind === 'answer' && row.directPhoto;
    const messages: DisplayMessage[] = [
      ...(row.question || directPhoto
        ? [
            {
              ...origin,
              id: questionId,
              role: 'user' as const,
              content: row.question,
              ...(directPhoto ? { photoAttached: true } : {}),
              ...(row.kind === 'answer' && row.delivery
                ? { delivery: row.delivery }
                : {}),
            },
          ]
        : []),
      {
        ...origin,
        id: answerId,
        role: 'assistant',
        content: row.kind === 'answer' ? row.answer : '',
        ...(directPhoto ? { directPhotoReply: true } : {}),
        ...(row.kind === 'answer' && row.initialResponse
          ? { initialResponse: row.initialResponse }
          : {}),
        ...(activity ? { activity } : {}),
        ...(row.kind === 'answer' && row.healthSummary
          ? { healthSummary: row.healthSummary }
          : {}),
        ...(row.kind === 'answer' && row.dailyReport
          ? { dailyReport: row.dailyReport }
          : {}),
        ...(row.kind === 'answer' && row.steeringInstructions
          ? { steeringInstructions: row.steeringInstructions }
          : {}),
        ...(row.kind === 'answer' && row.savedCitations
          ? { savedCitations: row.savedCitations }
          : {}),
        ...(row.kind === 'answer' && row.archivedCitationTarget
          ? { archivedCitationTarget: row.archivedCitationTarget }
          : {}),
      },
    ];
    if (afterLiveId === undefined) historical.push(...messages);
    else mounted.push({ after: afterLiveId, messages });
  }
  let index = 0;
  for (const message of live) {
    while (mounted[index] && message.id > mounted[index]!.after)
      historical.push(...mounted[index++]!.messages);
    historical.push(message);
  }
  for (; index < mounted.length; index++)
    historical.push(...mounted[index]!.messages);
  return historical;
}

/** Never paint another route, pending account owner, or replaced lease's retained prose. */
export function visibleSavedHistoryDisplay(
  session: ConversationSession,
  active = true,
) {
  if (
    !active ||
    session.quarantined ||
    session.restoring ||
    session.restoreFailed ||
    session.leaseRefreshRequired ||
    (session.modelSelectionPending && !session.modelSelectionKeepsDisplay) ||
    session.modelSelectionFailed
  )
    return undefined;
  return session.savedHistoryDisplay;
}
