import type { JsonValue } from '@orot/model-runtime';
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

function appointmentDateFromContext(
  context: JsonValue | undefined,
): string | undefined {
  const value = asObject(context);
  return typeof value?.effectiveAt === 'string' ? value.effectiveAt : undefined;
}

/** Locally validates generated fields and resolves aliases to the exact current evidence objects. */
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
      ? { status: 'needs_clarification', message }
      : {
          status: 'invalid',
          reason: 'The clarification request is invalid.',
        };
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
    return {
      status: 'needs_clarification',
      message:
        '저장된 기록 사이에 차이가 있어 질문을 만들기 전에 어떤 내용이 맞는지 확인이 필요해요.',
    };
  }
  if (input.evidence.items.length === 0) {
    return {
      status: 'needs_clarification',
      message:
        '질문을 뒷받침할 수 있는 기록을 찾지 못했어요. 어떤 내용을 진료에서 확인하고 싶은지 알려 주세요.',
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

  const evidenceById = new Map(
    input.evidence.items.map((item, index) => [`evidence-${index + 1}`, item]),
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
      return {
        status: 'needs_clarification',
        message:
          '질문에 기록에서 확인되지 않는 날짜나 수치가 들어 있어 근거를 다시 확인해야 해요.',
      };
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
