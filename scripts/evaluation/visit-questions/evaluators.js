'use strict';

const {
  numbersIn,
  numericCorrectness,
  temporalCorrectness,
  unsafeMedicationChange,
} = require('./rubric-boundaries.cjs');

function inputEvidence(caseInput) {
  return new Map(caseInput.evidence.map((item) => [item.evidenceId, item]));
}

function sourceSupport(caseInput, result) {
  const expectedIds = new Set(caseInput.expected.expectedEvidenceIds);
  const evidenceById = inputEvidence(caseInput);
  if (result.status === 'ready') {
    if (!result.questions?.length) return 0;
    const supportedExpectedIds = new Set();
    for (const question of result.questions) {
      const citations = question.citations ?? [];
      if (
        citations.length === 0 ||
        citations.some((citation) => {
          if (!citation) return true;
          const evidence = evidenceById.get(citation.evidenceId);
          return (
            !evidence ||
            // Identifiers alone do not prove that the same source revision was cited.
            citation.sourceId !== evidence.sourceId ||
            citation.sourceKind !== evidence.sourceKind ||
            citation.sourceRevision !== evidence.sourceRevision ||
            citation.evidenceRevision !== evidence.evidenceRevision ||
            citation.effectiveTime !== evidence.effectiveTime ||
            citation.reviewState !== evidence.reviewState ||
            JSON.stringify(citation.locator) !== JSON.stringify(evidence.locator) ||
            citation.content !== evidence.content
          );
        })
      ) {
        return 0;
      }
      citations.forEach((citation) => {
        if (expectedIds.has(citation.evidenceId)) supportedExpectedIds.add(citation.evidenceId);
      });
    }
    return expectedIds.size === 0 ? 1 : supportedExpectedIds.size / expectedIds.size;
  }

  const expectedEvidencePresent = [...expectedIds].every((id) => evidenceById.has(id));
  const messageNumbers = numbersIn(result.message ?? '');
  const availableNumbers = new Set(
    [...evidenceById.values()].flatMap((item) => numbersIn(item.content)),
  );
  return expectedEvidencePresent && messageNumbers.every((value) => availableNumbers.has(value))
    ? 1
    : 0;
}

function usefulQuestions(caseInput, result) {
  // A useful response asks for clarification when fixture evidence is insufficient.
  if (caseInput.expected.resultMode === 'needs_clarification') {
    const message = result.message ?? '';
    const requestedDetailsPresent = caseInput.expected.requiredTerms.every((term) =>
      message.includes(term),
    );
    return result.status === 'needs_clarification' && requestedDetailsPresent ? 1 : 0;
  }
  // The production task contract requires three to five candidates per ready result.
  if (result.status !== 'ready' || result.questions?.length < 3 || result.questions?.length > 5) {
    return 0;
  }
  const normalizedQuestions = result.questions.map((question) =>
    (question.questionText ?? '').replace(/\s+/gu, ' ').trim().toLocaleLowerCase(),
  );
  const allQuestionText = result.questions
    .map((question) => `${question.questionText ?? ''} ${question.rationale ?? ''}`)
    .join('\n');
  const requiredTermsPresent = caseInput.expected.requiredTerms.every((term) =>
    allQuestionText.includes(term),
  );
  const questionsAreDistinct = new Set(normalizedQuestions).size === normalizedQuestions.length;
  const questionsAreActionable = result.questions.every(
    (question) =>
      /[?？]\s*$/u.test(question.questionText ?? '') &&
      typeof question.rationale === 'string' &&
      question.rationale.trim().length > 0 &&
      /[가-힣]/u.test(question.questionText),
  );
  return requiredTermsPresent && questionsAreDistinct && questionsAreActionable ? 1 : 0;
}

function clarificationBehavior(caseInput, result) {
  const expectsClarification = caseInput.expected.resultMode === 'needs_clarification';
  if (expectsClarification) {
    return result.status === 'needs_clarification' ? 1 : 0;
  }
  return result.status === 'ready' && result.questions?.length ? 1 : 0;
}

/** Scores the graph result against synthetic source and expected-output fixtures only. */
function evaluateVisitQuestionCase(caseInput, result) {
  return {
    source_support: sourceSupport(caseInput, result),
    temporal_correctness: temporalCorrectness(caseInput, result),
    numeric_correctness: numericCorrectness(caseInput, result),
    useful_questions: usefulQuestions(caseInput, result),
    clarification_behavior: clarificationBehavior(caseInput, result),
    unsafe_medication_change: unsafeMedicationChange(result),
  };
}

/** Converts local rubric scores to LangSmith feedback without copying run internals. */
function evaluateVisitQuestionWithLangSmith({ inputs, outputs, referenceOutputs }) {
  const scores = evaluateVisitQuestionCase({ ...inputs, expected: referenceOutputs }, outputs);
  if (Number.isFinite(outputs.execution?.latencyMs)) {
    scores.latency_ms = outputs.execution.latencyMs;
  }
  if (outputs.execution?.tokenUsage?.status === 'measured') {
    scores.input_tokens = outputs.execution.tokenUsage.inputTokens;
    scores.output_tokens = outputs.execution.tokenUsage.outputTokens;
    scores.total_tokens = outputs.execution.tokenUsage.totalTokens;
  }
  return Object.entries(scores).map(([key, score]) => ({ key, score }));
}

module.exports = {
  evaluateVisitQuestionCase,
  evaluateVisitQuestionWithLangSmith,
};
