'use strict';

function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const {
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    total_tokens: totalTokens,
  } = usage;
  if (
    !Number.isSafeInteger(inputTokens) ||
    inputTokens < 0 ||
    !Number.isSafeInteger(outputTokens) ||
    outputTokens < 0 ||
    !Number.isSafeInteger(totalTokens) ||
    totalTokens < 0 ||
    totalTokens !== inputTokens + outputTokens
  ) {
    return null;
  }
  return { inputTokens, outputTokens, totalTokens };
}

/** Sums only complete counts returned by successful API responses; gaps invalidate the run total. */
function createTokenUsageCollector() {
  let responseCount = 0;
  let allResponsesMeasured = true;
  const totals = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

  function record(usage) {
    responseCount += 1;
    const measured = normalizeUsage(usage);
    if (!measured) {
      allResponsesMeasured = false;
      return;
    }
    totals.inputTokens += measured.inputTokens;
    totals.outputTokens += measured.outputTokens;
    totals.totalTokens += measured.totalTokens;
  }

  return {
    record,
    markUnmeasured() {
      responseCount += 1;
      allResponsesMeasured = false;
    },
    snapshot() {
      return responseCount > 0 &&
        allResponsesMeasured &&
        Object.values(totals).every(Number.isSafeInteger)
        ? { ...totals }
        : null;
    },
  };
}

module.exports = { createTokenUsageCollector, normalizeUsage };
