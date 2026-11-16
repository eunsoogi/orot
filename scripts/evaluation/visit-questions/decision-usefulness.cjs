'use strict';

const GENERIC_FILLER = [
  /(?:실제|진짜).{0,8}(?:변화|수치|기록).{0,18}(?:확인|구분|검증)/u,
  /(?:더|추가로).{0,12}(?:준비|확인)할.{0,12}(?:내용|것|사항)/u,
  /(?:효과|안전성).{0,10}(?:어떻게|무엇으로).{0,12}평가/u,
];

/**
 * Fixture-specific lexical proxy, NOT a clinical or semantic judge.
 * Anchors and decisions must occur in the same question (not only its rationale).
 * Human review still decides whether the decision matters and is supported.
 */
function decisionUsefulness(testCase, result) {
  const rubric = testCase.expected.decisionRubric;
  if (!rubric) return null;
  if (rubric.noQuestionExpected) {
    return result.status === 'needs_clarification' &&
      !result.questions?.length &&
      !/(?:기록|자료).{0,8}(?:없|부족)|(?:진료|치료).{0,8}(?:필요 없|불필요)|정상입니다/u.test(
        result.message ?? '',
      )
      ? 1
      : 0;
  }
  if (result.status !== 'ready' || !result.questions?.length) return 0;
  const matched = new Set();
  for (const question of result.questions) {
    const text = question.questionText ?? '';
    if (GENERIC_FILLER.some((pattern) => pattern.test(text))) return 0;
    const topic = rubric.decisions.find(
      (decision) =>
        decision.anchorTerms.some((term) => text.includes(term)) &&
        decision.decisionTerms.some((term) => text.includes(term)) &&
        question.citations?.some((citation) => decision.evidenceIds.includes(citation.evidenceId)),
    );
    if (!topic || matched.has(topic.id)) return 0;
    matched.add(topic.id);
  }
  return rubric.requiredDecisionIds.every((id) => matched.has(id)) ? 1 : 0;
}

const HUMAN_REVIEW = [
  'Does each question resolve a concrete decision relevant to the stated visit goal?',
  'Does the cited record support the premise, timing and uncertainty without invented needs?',
  'Would the question remain generic if record names and values were removed?',
  'Are lower-value duplicates and logistical filler omitted, including a legitimate no-question outcome?',
  'Does the response avoid diagnosis, treatment instructions and reassurance that care is unnecessary?',
];

module.exports = { decisionUsefulness, HUMAN_REVIEW };
