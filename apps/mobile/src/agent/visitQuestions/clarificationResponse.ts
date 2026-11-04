import type { JsonValue } from '@orot/model-runtime';
import { t } from '../../i18n';
import { hasUnsupportedQuestionFacts } from './questionFactValidation';
import {
  asQuestionObject,
  hasOnlyQuestionKeys,
  readKoreanQuestionText,
} from './questionShape';
import type {
  VisitQuestionResponderInput,
  VisitQuestionTaskResult,
  VisitQuestionTaskValidation,
} from './taskContract';

const REQUESTED_DATE_PATTERNS = [
  /(?<!\d)(?:19|20)\d{2}[-/.](?:0?[1-9]|1[0-2])(?:[-/.](?:0?[1-9]|[12]\d|3[01]))?(?!\d)/gu,
  /(?<!\d)(?:19|20)\d{2}\s*년\s*(?:0?[1-9]|1[0-2])\s*월(?:\s*(?:0?[1-9]|[12]\d|3[01])\s*일)?/gu,
];
// Cover the distinct Korean imperative endings used by noun and verb action stems.
const MEDICATION_INSTRUCTION =
  /(?:약|약물|용량|복용|투약|처방|치료).{0,20}(?:중단|시작|변경|조절|증량|감량|늘리|줄이|바꾸|끊|복용하지|투여하지|먹지)(?:하세요|하십시오|으세요|세요|으십시오|해야 합니다|해야 해요|해야 한다|해야 돼요|하셔야|셔야|으셔야|하시기 바랍니다|하지 마세요|마세요)/u;
const DIAGNOSTIC_CLAIM =
  /(?:고혈압|당뇨(?:병)?|고지혈증|심부전|[가-힣]{1,10}(?:병|증|염|암|질환)|진단).{0,16}(?:이므로|이라서|라서|때문에|로 보입니다|로 판단|이라고 할 수|입니다|이에요|일 수 있)/u;

/** Suppresses explicit diagnosis claims and medication or treatment instructions. */
export function hasUnsafeClinicalAdvice(message: string): boolean {
  return MEDICATION_INSTRUCTION.test(message) || DIAGNOSTIC_CLAIM.test(message);
}

export function appointmentDateFromContext(
  context: JsonValue | undefined,
): string | undefined {
  const value = asQuestionObject(context);
  return typeof value?.effectiveAt === 'string' ? value.effectiveAt : undefined;
}

export function clarification(
  message: string,
): VisitQuestionTaskValidation<VisitQuestionTaskResult> {
  return { status: 'valid', value: { status: 'needs_clarification', message } };
}

/** Retains only safe clarification copy; gap dates never authorize measurements. */
export function validateClarificationResponse(
  result: Record<string, unknown>,
  input: VisitQuestionResponderInput,
): VisitQuestionTaskValidation<VisitQuestionTaskResult> {
  if (!hasOnlyQuestionKeys(result, ['status', 'message']))
    return {
      status: 'invalid',
      reason: 'The clarification response has extra fields.',
    };
  if (
    typeof result.message === 'string' &&
    hasUnsafeClinicalAdvice(result.message)
  )
    return {
      status: 'invalid',
      reason: 'The clarification contains unsafe clinical advice.',
    };
  const message = readKoreanQuestionText(result.message, 400);
  if (!message) {
    if (typeof result.message === 'string')
      return clarification(
        t('visitQuestions.validation.unusableClarification'),
      );
    return {
      status: 'invalid',
      reason: 'The clarification request is invalid.',
    };
  }
  const context = [
    appointmentDateFromContext(input.context),
    ...input.evidence.coverage.flatMap(coverage =>
      coverage.gaps.flatMap(gap =>
        REQUESTED_DATE_PATTERNS.flatMap(pattern =>
          [...gap.matchAll(pattern)].map(([date]) => date),
        ),
      ),
    ),
  ]
    .filter((value): value is string => value !== undefined)
    .join(' ');
  if (hasUnsupportedQuestionFacts(message, input.evidence.items, context))
    return clarification(t('visitQuestions.validation.unverifiedDateOrValue'));
  return clarification(message);
}
