import { DEFAULT_MULTI_AGENT_BUDGET } from '@orot/agent-runtime';
import type { EvidenceReference } from '@orot/agent-runtime';
import type { Appointment } from '@orot/domain';
import {
  localEvidenceFingerprint,
  visitQuestionCitationKey,
} from '../../agent/visitQuestions/evidence';
import type {
  VisitQuestionCandidate,
  VisitQuestionEvidenceItem,
} from '../../agent/visitQuestions/taskContract';
import type {
  EvidenceCaveat,
  NextVisitQuestion,
  SaveReviewedQuestionsResult,
} from '../../nextVisitQuestions/types';

export interface VisitQuestionRouteSaveInput {
  readonly appointment: Appointment;
  readonly questions: readonly NextVisitQuestion<VisitQuestionEvidenceItem>[];
  readonly caveats: readonly EvidenceCaveat[];
  readonly resolveSource: (
    reference: EvidenceReference,
  ) => EvidenceReference | undefined;
}

export interface VisitQuestionRouteSaveResult extends SaveReviewedQuestionsResult<VisitQuestionEvidenceItem> {
  readonly validateSource: (
    reference: VisitQuestionEvidenceItem,
    signal: AbortSignal,
  ) => Promise<boolean>;
}

function freshCitation(
  items: readonly VisitQuestionEvidenceItem[],
  citation: VisitQuestionEvidenceItem,
  resolved: EvidenceReference | undefined,
) {
  return items.find(item =>
    resolved
      ? item.sourceKind === resolved.sourceKind &&
        item.sourceId === resolved.sourceId &&
        item.evidenceId === resolved.evidenceId
      : visitQuestionCitationKey(item) === visitQuestionCitationKey(citation),
  );
}

export async function saveVisitQuestionRoute(
  input: VisitQuestionRouteSaveInput,
): Promise<VisitQuestionRouteSaveResult> {
  const { prepareUpcomingVisitQuestionContext } =
    await import('../../agent/visitQuestions/localContext');
  const context = await prepareUpcomingVisitQuestionContext({
    now: new Date().toISOString(),
    maxEvidenceItems: DEFAULT_MULTI_AGENT_BUDGET.maxEvidenceItems,
  });
  if (
    context.status !== 'ready' ||
    context.appointment.id !== input.appointment.id ||
    localEvidenceFingerprint(context.appointment) !==
      localEvidenceFingerprint(input.appointment)
  ) {
    throw new Error('The current appointment changed before save.');
  }

  // Re-read source rows through #30's validation closure so deleted or revised citations cannot return from the screen cache.
  const cache = new Map<string, VisitQuestionEvidenceItem>();
  const reviewed: VisitQuestionCandidate[] = [];
  for (const question of input.questions) {
    const citations: VisitQuestionEvidenceItem[] = [];
    for (const citation of question.citations) {
      if (citation.sourceKind === 'external_medical')
        throw new Error(
          'Visit questions can only cite current local evidence.',
        );
      const resolved = input.resolveSource(citation);
      const key = resolved
        ? [resolved.sourceKind, resolved.sourceId, resolved.evidenceId].join(
            '\u0000',
          )
        : visitQuestionCitationKey(citation);
      let current =
        cache.get(key) ??
        freshCitation(context.evidence.batch.items, citation, resolved);
      if (!current) {
        const searched = await context.searchEvidence(
          citation.content,
          DEFAULT_MULTI_AGENT_BUDGET.maxEvidenceItems,
          citation.sourceKind,
        );
        current = freshCitation(searched.batch.items, citation, resolved);
      }
      if (!current)
        throw new Error('A cited source changed or is no longer available.');
      cache.set(key, current);
      citations.push(current);
    }
    reviewed.push({
      questionText: question.questionText,
      rationale: question.rationale,
      priority: question.priority,
      citations,
    });
  }

  const saved = await context.saveReviewedQuestions(reviewed);
  return {
    questions: reviewed,
    caveats: input.caveats,
    memoryStatus: saved.memoryStatus,
    validateSource: async (reference, signal) =>
      !signal.aborted && (await context.revalidateEvidence([reference])),
  };
}
