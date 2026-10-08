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
const MEDICATION_INSTRUCTION =
  /(?:약|약물|용량|복용|투약|처방|치료).{0,20}(?:중단|시작|변경|조절|증량|감량|늘리|줄이|바꾸|끊|복용하지|투여하지|먹지)(?:하세요|십시오|해야 합니다|해야 해요|하시기 바랍니다|하지 마세요|마세요)/u;
const DIAGNOSTIC_CLAIM =
  /(?:고혈압|당뇨(?:병)?|고지혈증|심부전|[가-힣]{1,10}(?:병|증|염|암|질환)|진단).{0,16}(?:이므로|이라서|라서|때문에|로 보입니다|로 판단|이라고 할 수|입니다|이에요|일 수 있)/u;

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
  // Keep only validated Korean clarification copy on the task-result path.
  return { status: 'valid', value: { status: 'needs_clarification', message } };
}

/** Suppresses explicit diagnosis claims and medication or treatment instructions in provider-authored copy. */
function hasUnsafeClinicalAdvice(message: string): boolean {
  return MEDICATION_INSTRUCTION.test(message) || DIAGNOSTIC_CLAIM.test(message);
}

function appointmentDateFromContext(
  context: JsonValue | undefined,
): string | undefined {
  const value = asObject(context);
  return typeof value?.effectiveAt === 'string' ? value.effectiveAt : undefined;
}

/** Validates generated fields and preserves only evidence-safe clarification copy as a task result. */
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
    if (!message) {
      return {
        status: 'invalid',
        reason: 'The clarification request is invalid.',
      };
    }
    if (
      hasUnsupportedDateOrValue(
        message,
        input.evidence.items,
        appointmentDateFromContext(input.context),
      )
    ) {
      return clarification(
        t('visitQuestions.validation.unverifiedDateOrValue'),
      );
    }
    if (hasUnsafeClinicalAdvice(message)) {
      return {
        status: 'invalid',
        reason: 'The clarification contains unsafe clinical advice.',
      };
    }
    return clarification(message);
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
