'use strict';

/**
 * LangSmith 0.10.7 processes all results before `evaluate()` returns and exhausts its iterator.
 * Validate the public result buffer instead of attempting to consume that iterator a second time.
 */
function assertLangSmithEvaluationComplete(experiment, expectedCount) {
  const rows = experiment?.results;
  if (
    !Array.isArray(rows) ||
    rows.length !== expectedCount ||
    experiment.length !== expectedCount
  ) {
    throw new Error('LangSmith did not finish every synthetic example.');
  }
  if (rows.some((row) => !row?.run)) throw new Error('LangSmith returned an incomplete run.');
  return rows;
}

module.exports = { assertLangSmithEvaluationComplete };
