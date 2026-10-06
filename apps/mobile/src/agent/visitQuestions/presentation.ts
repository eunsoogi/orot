import { visitQuestionCitationKey } from './evidence';
import type {
  VisitQuestionCandidate,
  VisitQuestionEvidenceItem,
  VisitQuestionTaskResult,
} from './taskContract';

export type VisitQuestionPresentationResult =
  | {
      readonly status: 'ready';
      readonly questions: readonly VisitQuestionCandidate[];
    }
  | { readonly status: 'needs_clarification'; readonly message: string }
  | { readonly status: 'refresh_required'; readonly message: string };

/** Rechecks the appointment and source revisions before any generated list reaches the UI. */
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
      message: '질문 근거를 다시 확인할 수 없어 제안을 새로 준비해야 해요.',
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
    message:
      '진료 일정이나 기록이 바뀌었어요. 최신 자료로 질문을 다시 준비해 주세요.',
  };
}
