/** Distinguishes a fresh durable write from idempotent reuse after the live owner check.
 * A report may already be in local history but be ineligible for live publication. */
export function dailyReportLiveCommit<Result extends object, Context>(
  result: Result,
  runId: string,
  saved: { context: Context; status: 'saved' | 'reused' },
) {
  return {
    ...result,
    runId,
    context: saved.context,
    freshCommit: saved.status === 'saved',
  };
}
