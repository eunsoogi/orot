function count(summary, label) {
  const match = summary.match(new RegExp(`(\\d+) ${label}\\b`, 'i'));
  return match ? Number(match[1]) : 0;
}

function total(summary) {
  const match = summary.match(/(\d+) total\b/i);
  return match ? Number(match[1]) : 0;
}

// Jest includes cases excluded by --testNamePattern in the total as skipped; only focused runs may accept those skips.
export function summarizeFocusedJestRun(testSummary, suiteSummary) {
  const passed = count(testSummary, 'passed');
  const failed = count(testSummary, 'failed');
  const pending = count(testSummary, 'pending');
  const skipped = count(testSummary, 'skipped');
  const todo = count(testSummary, 'todo');
  const failedSuites = count(suiteSummary, 'failed');
  const passedSuites = count(suiteSummary, 'passed');
  const pendingSuites = count(suiteSummary, 'pending');
  const skippedSuites = count(suiteSummary, 'skipped');

  if (
    passed !== 1 ||
    total(testSummary) !== passed + skipped ||
    failed !== 0 ||
    pending !== 0 ||
    todo !== 0 ||
    passedSuites !== 1 ||
    failedSuites !== 0 ||
    pendingSuites !== 0 ||
    skippedSuites !== 0
  ) {
    throw new Error(
      'Focused Detox run must pass exactly one selected test with no failure, pending, todo, or skipped suite',
    );
  }

  return `1 selected test passed; ${skipped} nonmatching tests skipped by name filter`;
}

export function validateFullJestRun(testSummary, suiteSummary, suiteName, runNumber) {
  const passed = count(testSummary, 'passed');
  const failed = count(testSummary, 'failed');
  const pending = count(testSummary, 'pending');
  const skipped = count(testSummary, 'skipped');
  const todo = count(testSummary, 'todo');
  const failedSuites = count(suiteSummary, 'failed');
  const pendingSuites = count(suiteSummary, 'pending');
  const skippedSuites = count(suiteSummary, 'skipped');

  if (
    passed !== total(testSummary) ||
    failed !== 0 ||
    pending !== 0 ||
    skipped !== 0 ||
    todo !== 0 ||
    failedSuites !== 0 ||
    pendingSuites !== 0 ||
    skippedSuites !== 0
  ) {
    throw new Error(
      `${suiteName}: Jest run ${runNumber} includes a failure, skip, pending test, or todo`,
    );
  }
}
