import {
  archivedVisitRevision,
  type ArchivedVisitBookmarkIdentity,
} from './archivedVisitBookmarkIdentity';
import { recoverArchiveLayout } from './conversationArchiveA2UI';
import { t } from '../i18n';
import type { StoredSteeringInstruction } from './conversationSteeringStorage';
import {
  archivedConversationPresentationMetadata,
  type ArchivedConversationPresentationMetadata,
} from './archivedConversationPresentationMetadata';
import { validConversationReportTarget } from './conversationReportTarget';
import {
  decodeReviewedOpening,
  type ReviewedOpening,
} from './conversationReviewedOpeningStorage';
import type { ConversationArtifact } from './conversationArtifactTypes';
import type { SavedArchivedCitation } from '../ragConversation/savedArchivedCitations';
import type { HealthSummaryResult } from '../ragConversation/healthSummary';
import {
  decodeConversationRecoveryReason,
  type ConversationRecoveryReason,
} from '../ragConversation/conversationExecutionLease';

/** Stored transcript, not a retained turn or source authorization. */
export type ConversationHistoryPresentation = {
  readonly id: string;
  readonly sessionId: string;
  readonly createdAt: string;
  readonly question: string;
  readonly interruptionReason?: ConversationRecoveryReason;
} & (
  | (ArchivedConversationPresentationMetadata & {
      readonly status: 'complete' | 'partial';
      readonly answer: string;
      readonly directPhoto?: true;
      readonly savedPossibilityNarrative?: true;
      readonly archivedA2UIPresentation?: import('../ragConversation/conversationA2UI').ConversationA2UINode;
      readonly healthSummary?: HealthSummaryResult;
      readonly dailyReport?: NonNullable<ConversationArtifact['dailyReport']>;
      readonly archivedVisitBookmark?: ArchivedVisitBookmarkIdentity;
      readonly savedCitations?: readonly SavedArchivedCitation[];
      readonly steeringInstructions?: readonly StoredSteeringInstruction[];
    })
  | { readonly status: 'interrupted'; readonly answer?: never }
  | {
      readonly status: 'opening';
      readonly initialResponse: ReviewedOpening;
      readonly answer?: never;
    }
);

function readArchivedText(serialized: unknown): Record<string, unknown> | null {
  if (typeof serialized !== 'string') return null;
  try {
    const value: unknown = JSON.parse(serialized);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function decodeOwnedArchiveRow(
  row: Record<string, unknown>,
  sessionId: string,
): {
  presentation: ConversationHistoryPresentation;
  value?: Record<string, unknown>;
} | null {
  if (
    typeof row.id !== 'string' ||
    typeof row.created_at !== 'string' ||
    !Number.isFinite(Date.parse(row.created_at)) ||
    new Date(row.created_at).toISOString() !== row.created_at
  )
    return null;
  const interruptionReason = decodeConversationRecoveryReason(
    row.interruption_reason,
  );
  const reviewed = decodeReviewedOpening(row.reviewed_opening_json);
  if (row.result_json === null) {
    if (row.checkpoint_status === 'completed') {
      const value = readArchivedText(row.local_outcome_json);
      if (
        value?.kind !== 'visit-goal' ||
        typeof row.checkpoint_question !== 'string' ||
        !row.checkpoint_question.trim()
      )
        return null;
      if (
        Object.keys(value).some(
          key => !['kind', 'delivery', 'initialResponse'].includes(key),
        )
      )
        return null;
      const display = archivedConversationPresentationMetadata(value);
      if (display.initialResponse && display.initialResponse.text.length > 300)
        return null;
      // No artifact value: only the display reader can render this local outcome.
      return {
        presentation: {
          id: row.id,
          sessionId,
          createdAt: row.created_at,
          question: row.checkpoint_question,
          status: 'complete',
          answer: t('visitQuestions.conversation.clarifyGoal'),
          ...display,
          ...(row.has_reviewed_opening === 1
            ? { initialResponse: reviewed }
            : {}),
        },
      };
    }
    if (
      row.checkpoint_status !== 'interrupted' ||
      typeof row.checkpoint_question !== 'string' ||
      !row.checkpoint_question.trim()
    )
      return null;
    return {
      presentation: {
        id: row.id,
        sessionId,
        createdAt: row.created_at,
        question: row.checkpoint_question,
        ...(reviewed
          ? { status: 'opening' as const, initialResponse: reviewed }
          : {
              status: 'interrupted' as const,
              ...(interruptionReason ? { interruptionReason } : {}),
            }),
      },
    };
  }
  const value = readArchivedText(row.result_json);
  if (
    !value ||
    value.id !== row.id ||
    value.sessionId !== sessionId ||
    value.createdAt !== row.created_at ||
    (value.status !== 'complete' && value.status !== 'partial') ||
    (row.request_id != null &&
      (value.status === 'complete'
        ? row.checkpoint_status !== 'completed' || row.completion_id !== row.id
        : row.checkpoint_status !== 'interrupted' ||
          row.completion_id != null)) ||
    typeof value.question !== 'string' ||
    (row.request_id != null && value.question !== row.checkpoint_question) ||
    typeof value.answer !== 'string' ||
    !value.answer.trim()
  )
    return null;
  const dailyReport =
    value.status === 'complete' &&
    validConversationReportTarget(value.dailyReport)
      ? (value.dailyReport as NonNullable<ConversationArtifact['dailyReport']>)
      : undefined;
  // A legacy artifact without the exact completed request/completion pair never gains a surface.
  const archivedA2UIPresentation =
    row.request_id === row.id && row.completion_id === row.id
      ? recoverArchiveLayout(value)
      : undefined;
  // This is affordance identity only. The selected read still owns every
  // Visit validation and does not borrow the archive page as authority.
  const visitRevision =
    value.status === 'complete' &&
    row.request_id === row.id &&
    row.completion_id === row.id &&
    row.interruption_reason == null &&
    typeof value.visitQuestions === 'object' &&
    value.visitQuestions !== null &&
    !Array.isArray(value.visitQuestions) &&
    !value.entryIntent &&
    !value.healthSummary &&
    !value.dailyReport &&
    !value.treatmentContext &&
    !value.submittedInput
      ? archivedVisitRevision(row.result_json)
      : undefined;
  return {
    value,
    presentation: {
      ...(visitRevision
        ? {
            archivedVisitBookmark: {
              id: row.id,
              sessionId,
              createdAt: row.created_at,
              revision: visitRevision,
            },
          }
        : {}),
      ...(archivedA2UIPresentation ? { archivedA2UIPresentation } : {}),
      id: row.id,
      sessionId,
      createdAt: value.createdAt,
      question: value.question,
      answer: value.answer,
      status: value.status,
      ...(value.status === 'complete' &&
      value.entryIntent === 'possibilities' &&
      !value.healthSummary &&
      !value.dailyReport &&
      !value.visitQuestions
        ? { savedPossibilityNarrative: true as const }
        : {}),
      ...archivedConversationPresentationMetadata(value),
      ...(row.has_reviewed_opening === 1 ? { initialResponse: reviewed } : {}),
      ...(dailyReport ? { dailyReport } : {}),
      ...(interruptionReason ? { interruptionReason } : {}),
    },
  };
}
