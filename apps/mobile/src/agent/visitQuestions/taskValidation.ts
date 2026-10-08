import type { JsonValue } from '@orot/model-runtime';
import { t } from '../../i18n';
import { hasUnsupportedDateOrValue } from './questionFacts';
import type {
  VisitQuestionEvidenceItem,
  VisitQuestionResponderInput,
  VisitQuestionTaskResult,
  VisitQuestionTaskValidation,
  VisitQuestionCandidate,
} from './taskContract';

const HANGUL = /[\uac00-\ud7a3]/u;

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return null;
  return value as Record<string, unknown>;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}

function readNonEmptyKoreanText(
  value: unknown,
  maximumLength: number,
): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 1 &&
    normalized.length <= maximumLength &&
    HANGUL.test(normalized)
    ? normalized
    : null;
}

function clarification(
  message: string,
): VisitQuestionTaskValidation<VisitQuestionTaskResult> {
  // Keep app-owned copy in the task result instead of the runtime's generic failure reason.
  return { status: 'valid', value: { status: 'needs_clarification', message } };
}

function appointmentDateFromContext(
  context: JsonValue | undefined,
): string | undefined {
  const value = asObject(context);
  return typeof value?.effectiveAt === 'string' ? value.effectiveAt : undefined;
}

/** Validates generated fields and preserves app-owned clarification copy as a task result. */
export function validateVisitQuestionTaskResult(
  value: JsonValue,
  input: VisitQuestionResponderInput,
): VisitQuestionTaskValidation<VisitQuestionTaskResult> {
  const result = asObject(value);
  if (!result)
    return { status: 'invalid', reason: 'The response must be an object.' };

  if (result.status === 'needs_clarification') {
    if (!hasOnlyKeys(result, ['status', 'message'])) {
      return {
        status: 'invalid',
        reason: 'The clarification response has extra fields.',
      };
    }
    const message = readNonEmptyKoreanText(result.message, 400);
    return message
      ? clarification(message)
      : { status: 'invalid', reason: 'The clarification request is invalid.' };
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
  if (input.evidence.conflicts.length > 0) {
    return clarification(t('visitQuestions.validation.conflictingRecords'));
  }
  if (input.evidence.items.length === 0) {
    return clarification(t('visitQuestions.validation.noEvidence'));
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

  const evidenceById = new Map(
    input.evidence.items.map(item => [item.evidenceId, item]),
  );
  const questions: VisitQuestionCandidate[] = [];
  for (const rawQuestion of result.questions) {
    const question = asObject(rawQuestion);
    if (
      !question ||
      !hasOnlyKeys(question, [
        'questionText',
        'rationale',
        'priority',
        'evidenceIds',
      ])
    ) {
      return {
        status: 'invalid',
        reason: 'A question contains unsupported fields.',
      };
    }
    const questionText = readNonEmptyKoreanText(question.questionText, 300);
    const rationale = readNonEmptyKoreanText(question.rationale, 400);
    if (
      !questionText ||
      !rationale ||
      !questionText.endsWith('?') ||
      (question.priority !== 'routine' && question.priority !== 'important')
    ) {
      return {
        status: 'invalid',
        reason: 'A question text, rationale, or priority is invalid.',
      };
    }
    if (
      !Array.isArray(question.evidenceIds) ||
      question.evidenceIds.length < 1 ||
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
    if (
      hasUnsupportedDateOrValue(
        `${questionText} ${rationale}`,
        exactCitations,
        appointmentDateFromContext(input.context),
      )
    ) {
      return clarification(
        t('visitQuestions.validation.unverifiedDateOrValue'),
      );
    }
    questions.push({
      questionText,
      rationale,
      priority: question.priority,
      citations: exactCitations,
    });
  }
  return { status: 'valid', value: { status: 'suggestions', questions } };
}
