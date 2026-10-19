import { prepareUpcomingVisitQuestionContext } from '../src/agent/visitQuestions/localContext';
/** Explicit synthetic-Simulator diagnostic: exercises the production search without model output. */
export async function probePerformanceVisitEvidence(): Promise<string> {
  try {
    const context = await prepareUpcomingVisitQuestionContext({
      now: new Date().toISOString(),
      maxEvidenceItems: 5,
    });
    if (context.status !== 'ready')
      return JSON.stringify({ preparation: context.status });
    const result = await context.searchEvidence(
      '최근 심박수 변화',
      8,
      'personal_record',
      new AbortController().signal,
    );
    return JSON.stringify({
      items: result.batch.items.length,
      coverage: result.batch.coverage.length,
    });
  } catch (error) {
    // This entry is reserved for synthetic data; never enable diagnostic error text in the shipping entry.
    return JSON.stringify({
      error: error instanceof Error ? error.message.slice(0, 320) : 'unknown',
    });
  }
}
