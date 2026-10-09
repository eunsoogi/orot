import type { NextVisitEvidenceReference, NextVisitQuestion } from './types';

/** Copies editable question fields while preserving each opaque citation reference. */
export function copyQuestions<TReference extends NextVisitEvidenceReference>(
  questions: readonly NextVisitQuestion<TReference>[],
): NextVisitQuestion<TReference>[] {
  return questions.map(question => ({
    ...question,
    citations: [...question.citations],
  }));
}

/** Requires a useful prompt, explanation, and source while allowing reviewed lists of one to five items. */
export function isValidReview<TReference extends NextVisitEvidenceReference>(
  questions: readonly NextVisitQuestion<TReference>[],
): boolean {
  if (questions.length < 1 || questions.length > 5) return false;
  const normalized = questions.map(question =>
    question.questionText.trim().toLocaleLowerCase('ko-KR'),
  );
  return (
    questions.every(
      question =>
        question.questionText.trim().length > 1 &&
        question.rationale.trim().length > 1 &&
        question.citations.length > 0,
    ) && new Set(normalized).size === normalized.length
  );
}
