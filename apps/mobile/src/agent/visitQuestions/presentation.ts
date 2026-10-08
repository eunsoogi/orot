import { visitQuestionCitationKey } from './evidence';
import type {
  VisitQuestionCandidate,
  VisitQuestionEvidenceItem,
  VisitQuestionTaskResult,
} from './taskContract';
import { t } from '../../i18n';

export type VisitQuestionPresentationResult =
  | {
      readonly status: 'ready';
      readonly questions: readonly VisitQuestionCandidate[];
    }
  | { readonly status: 'needs_clarification'; readonly message: string }
  | { readonly status: 'refresh_required'; readonly message: string };

/** Rechecks appointment and source revisions; provider-authored clarification stays separate from app fallbacks. */
export async function validateVisitQuestionPresentation(
  result: VisitQuestionTaskResult,
  revalidateEvidence: (
    citations: readonly VisitQuestionEvidenceItem[],
  ) => Promise<boolean>,
): Promise<VisitQuestionPresentationResult> {
  if (result.status === 'needs_clarification') return result;
  const citations = new Map<string, VisitQuestionEvidenceItem>();
  for (const question of result.questions) {
    for (const citation of question.citations) {
      citations.set(visitQuestionCitationKey(citation), citation);
    }
  }
  if (citations.size === 0) {
    return {
      status: 'refresh_required',
      message: t('visitQuestions.presentation.noEvidence'),
    };
  }
  try {
    if (await revalidateEvidence([...citations.values()])) {
      return { status: 'ready', questions: result.questions };
    }
  } catch {
    // A failed local reread is treated as stale evidence, never as permission to show a draft.
  }
  return {
    status: 'refresh_required',
    message: t('visitQuestions.presentation.staleEvidence'),
  };
}
