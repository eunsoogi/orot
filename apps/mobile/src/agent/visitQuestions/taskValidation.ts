import type { JsonValue } from '@orot/model-runtime';
import { hasUnsupportedQuestionFacts } from './questionFactValidation';
import { isKnownClarification } from './clarificationQuestions';
import {
  appointmentDateFromContext,
  hasUnsafeClinicalAdvice,
  validateClarificationResponse,
} from './clarificationResponse';
export {
  appointmentDateFromContext,
  hasUnsafeClinicalAdvice,
} from './clarificationResponse';
import {
  asQuestionObject as asObject,
  hasOnlyQuestionKeys as hasOnlyKeys,
  readKoreanQuestionText as readNonEmptyKoreanText,
} from './questionShape';
import type {
  VisitQuestionEvidenceItem,
  VisitQuestionResponderInput,
  VisitQuestionTaskResult,
  VisitQuestionTaskValidation,
  VisitQuestionCandidate,
} from './taskContract';

// Shared by validation reporting and the bounded correction prompt.
export const UNSUPPORTED_QUESTION_FACTS_REASON =
  'A visit question contains an unsupported date or numeric value.';

/** Validates generated fields and preserves only evidence-safe clarification copy as a task result. */
export function validateVisitQuestionTaskResult(
  value: JsonValue,
  input: VisitQuestionResponderInput,
): VisitQuestionTaskValidation<VisitQuestionTaskResult> {
  const result = asObject(value);
  if (!result)
    return { status: 'invalid', reason: 'The response must be an object.' };

  if (result.status === 'needs_clarification') {
    return validateClarificationResponse(result, input);
  }

  if (
    result.status !== 'suggestions' ||
    !hasOnlyKeys(result, ['status', 'questions'])
  ) {
    return {
      status: 'invalid',
      reason: 'The response status is not supported.',
    };
  }
  if (
    !Array.isArray(result.questions) ||
    result.questions.length < 3 ||
    result.questions.length > 5
  ) {
    return {
      status: 'invalid',
      reason: 'A visit requires three to five question candidates.',
    };
  }
  // A batch-wide conflict does not identify which observation is safe to assert.
  // Until conflicts carry per-item identities, only uncited clarification can use it.
  if (
    (input.evidence.conflicts.length > 0 ||
      input.evidence.items.length === 0) &&
    result.questions.some(raw => asObject(raw)?.kind !== 'clarification')
  ) {
    return {
      status: 'invalid',
      reason:
        'Conflicting or absent evidence requires clarification-only questions.',
    };
  }

  if (
    input.evidence.items.length > 0 &&
    input.evidence.conflicts.length === 0 &&
    input.evidence.coverage.some(
      coverage =>
        coverage.gaps.length > 0 ||
        (coverage.truncated &&
          !(
            coverage.sourceKind !== 'external_medical' &&
            coverage.selectionMethod === 'ranked_retrieval'
          )),
    ) &&
    (!result.questions.some(raw => asObject(raw)?.kind === 'clarification') ||
      !result.questions.some(
        raw => (asObject(raw)?.kind ?? 'confirmed_fact') === 'confirmed_fact',
      ))
  ) {
    return {
      status: 'invalid',
      reason:
        'Partial evidence requires both supported and clarification questions.',
    };
  }

  const evidenceById = new Map(
    input.evidence.items.map(item => [item.evidenceId, item]),
  );
  const questions: VisitQuestionCandidate[] = [];
  // Inspect the whole list before offering a bounded correction: a bad number cannot hide
  // another question's invalid citation or unsafe clinical copy.
  let missingQuestionMark = false;
  let unsupportedFacts = false;
  for (const rawQuestion of result.questions) {
    const question = asObject(rawQuestion);
    if (
      !question ||
      !hasOnlyKeys(question, [
        'questionText',
        'rationale',
        'priority',
        'evidenceIds',
        'kind',
      ])
    ) {
      return {
        status: 'invalid',
        reason: 'A question contains unsupported fields.',
      };
    }
    const questionText = readNonEmptyKoreanText(question.questionText, 300);
    const rationale = readNonEmptyKoreanText(question.rationale, 400);
    if (!questionText) {
      return {
        status: 'invalid',
        reason: 'A question text is invalid.',
      };
    }
    // Keep the validator strict; the task contract may request one bounded regeneration.
    if (!questionText.endsWith('?')) missingQuestionMark = true;
    if (
      !rationale ||
      (question.priority !== 'routine' && question.priority !== 'important')
    ) {
      return {
        status: 'invalid',
        reason: 'A rationale or priority is invalid.',
      };
    }
    const kind = question.kind ?? 'confirmed_fact';
    if (kind !== 'confirmed_fact' && kind !== 'clarification') {
      return { status: 'invalid', reason: 'A question kind is invalid.' };
    }
    // Uncited provider prose cannot establish personal facts. Only app-owned
    // conditional wording can be generated; human edits are handled at review.
    if (
      kind === 'clarification' &&
      !isKnownClarification(questionText, rationale)
    ) {
      return {
        status: 'invalid',
        reason: 'An uncited clarification must use app-owned wording.',
      };
    }
    if (
      !Array.isArray(question.evidenceIds) ||
      (kind === 'clarification'
        ? question.evidenceIds.length !== 0
        : question.evidenceIds.length < 1) ||
      question.evidenceIds.length > 3 ||
      question.evidenceIds.some(id => typeof id !== 'string') ||
      new Set(question.evidenceIds).size !== question.evidenceIds.length
    ) {
      return {
        status: 'invalid',
        reason: 'A question must cite one to three unique evidence IDs.',
      };
    }
    const citations = question.evidenceIds.map(id =>
      evidenceById.get(id as string),
    );
    if (citations.some(citation => citation === undefined)) {
      return {
        status: 'invalid',
        reason: 'A question cited evidence outside the current result set.',
      };
    }
    const exactCitations = citations as VisitQuestionEvidenceItem[];
    if (hasUnsafeClinicalAdvice(`${questionText} ${rationale}`)) {
      return {
        status: 'invalid',
        reason: 'A visit question contains unsafe clinical advice.',
      };
    }
    if (
      hasUnsupportedQuestionFacts(
        `${questionText} ${rationale}`,
        exactCitations,
        appointmentDateFromContext(input.context),
      )
    ) {
      unsupportedFacts = true;
    }
    questions.push({
      kind,
      questionText,
      rationale,
      priority: question.priority,
      citations: exactCitations,
    });
  }
  if (unsupportedFacts) {
    return {
      status: 'invalid',
      reason: UNSUPPORTED_QUESTION_FACTS_REASON,
    };
  }
  if (missingQuestionMark) {
    return {
      status: 'invalid',
      reason: 'A visit question must end with a question mark.',
    };
  }
  return { status: 'valid', value: { status: 'suggestions', questions } };
}
