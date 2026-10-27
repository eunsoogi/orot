'use strict';

const { evaluateVisitQuestionCase } = require('./evaluators');

/** Retrieval recall uses evidence actually delivered to the model, never its chosen citations. */
function comparisonMetrics(testCase, output, deliveredIds) {
  const expected = new Set(testCase.expected.expectedEvidenceIds);
  const delivered = new Set(deliveredIds);
  const rubric = evaluateVisitQuestionCase(testCase, output);
  const measurable = ['ready', 'needs_clarification'].includes(output.status);
  return {
    retrieval_recall: expected.size
      ? [...expected].filter((id) => delivered.has(id)).length / expected.size
      : null,
    citation_support: measurable ? rubric.source_support : null,
    temporal_error: measurable ? 1 - rubric.temporal_correctness : null,
    numeric_error: measurable ? 1 - rubric.numeric_correctness : null,
    clarification_count: measurable ? Number(output.status === 'needs_clarification') : null,
    useful_questions: measurable ? rubric.useful_questions : null,
    clarification_behavior: measurable ? rubric.clarification_behavior : null,
    unsafe_medication_change: measurable ? 1 - rubric.unsafe_medication_change : null,
    latency_ms: output.execution.latencyMs,
    token_usage: output.execution.tokenUsage,
  };
}

const DIRECTIONS = {
  retrieval_recall: 1,
  citation_support: 1,
  temporal_error: -1,
  numeric_error: -1,
  useful_questions: 1,
  clarification_behavior: 1,
  unsafe_medication_change: -1,
  latency_ms: -1,
};

/** Keep every per-case regression against full context, including faster but less useful runs. */
function regressionsFor(rows) {
  const pairs = rows.flatMap((baseline, index) =>
    rows.slice(index + 1).map((row) => ({ baseline, row })),
  );
  return pairs.map(({ baseline, row }) => {
    const worseMetrics = Object.entries(DIRECTIONS).flatMap(([key, direction]) => {
      const before = baseline.metrics[key];
      const after = row.metrics[key];
      return typeof before === 'number' &&
        typeof after === 'number' &&
        (after - before) * direction < 0
        ? [key]
        : [];
    });
    const before = baseline.metrics.token_usage;
    const after = row.metrics.token_usage;
    if (
      before.status === 'measured' &&
      after.status === 'measured' &&
      after.totalTokens > before.totalTokens
    ) {
      worseMetrics.push('total_tokens');
    }
    return {
      baseline: baseline.path,
      path: row.path,
      worseMetrics,
      executionFailed: row.executionStatus === 'failed',
    };
  });
}

module.exports = { comparisonMetrics, regressionsFor };
