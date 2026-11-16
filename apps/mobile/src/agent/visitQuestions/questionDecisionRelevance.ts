import type {
  VisitQuestionResponderInput,
  VisitQuestionTaskResult,
  VisitQuestionTaskValidation,
} from './taskContract';
import { clarificationQuestionsForEvidence } from './clarificationQuestions';
import { t } from '../../i18n';

export const QUESTION_DECISION_RELEVANCE_REASON =
  'A visit question substitutes unsupported record verification or unrelated testing for a care decision.';

// This narrow wording guard is not a clinical relevance classifier. It catches a known
// regression only; absence of a match never certifies useful or medically appropriate output.
const verification =
  /(?:실제|진짜).{0,8}(?:변화|수치|기록).{0,18}(?:확인|구분|검증)|(?:기록|측정|수치).{0,8}(?:정확한지|맞는지|오류인지)|(?:재측정|다시 측정).{0,12}(?:확인|검증)/u;
const requestedVerification =
  /측정.{0,12}(?:정확|방법|오류|신뢰)|(?:기록|수치|측정값).{0,30}(?:맞는지|정확|신뢰|믿|실제.{0,4}변화|오류)|(?:재측정|다시 측정)/u;

function hasRecordedMeasurementConcern(content: string) {
  // Negated error statements must not become a reason to doubt otherwise usable records.
  return content
    .split(/[.!?\n]/u)
    .some(
      sentence =>
        /(?:측정|센서|기기).{0,12}(?:오류|잘못|불량|부정확|오작동)|측정 조건.{0,8}(?:다름|달랐|변경)|measurement error|sensor error/iu.test(
          sentence,
        ) &&
        !/(?:오류|잘못|불량|부정확|오작동|error).{0,16}(?:없|아니|않)|(?:no|without).{0,12}(?:error)/iu.test(
          sentence,
        ),
    );
}

/** New generation only: do not invalidate retained exact drafts or rewrite user-edited questions. */
export function validateQuestionDecisionRelevance(
  result: VisitQuestionTaskValidation<VisitQuestionTaskResult>,
  input: VisitQuestionResponderInput,
): VisitQuestionTaskValidation<VisitQuestionTaskResult> {
  if (result.status !== 'valid' || result.value.status !== 'suggestions')
    return result;

  for (const question of result.value.questions) {
    if (
      verification.test(question.questionText) &&
      !requestedVerification.test(input.request) &&
      !input.evidence.conflicts.length &&
      !question.citations.some(item =>
        hasRecordedMeasurementConcern(item.content),
      )
    ) {
      return { status: 'invalid', reason: QUESTION_DECISION_RELEVANCE_REASON };
    }
    // A conditional stock question is safe wording, not evidence that testing is a useful topic.
    if (
      question.kind === 'clarification' &&
      question.questionText ===
        t('nextVisit.clarification.testingPurpose.question') &&
      !hasTestingTopic(input)
    ) {
      return { status: 'invalid', reason: QUESTION_DECISION_RELEVANCE_REASON };
    }
  }
  return result;
}

function hasTestingTopic(input: VisitQuestionResponderInput) {
  const material = [
    input.request,
    JSON.stringify(input.context ?? null),
    ...input.evidence.items.map(item => item.content),
  ].join(' ');
  return /검사|검진|test|screening/iu.test(material);
}

/** Avoid offering an unrelated stock test question before the model spends its correction budget. */
export function clarificationQuestionsForContext(
  input: VisitQuestionResponderInput,
) {
  return clarificationQuestionsForEvidence(
    input.evidence.conflicts.length > 0,
  ).filter(
    pair =>
      pair.questionText !==
        t('nextVisit.clarification.testingPurpose.question') ||
      hasTestingTopic(input),
  );
}
