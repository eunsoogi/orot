/** Observation boundaries, not provider-success or physical cancellation acknowledgments. */
export type ModelStage = 'consent_wait' | 'provider_wait' | 'evidence_check';
export type ModelStageObserver = (
  stage: ModelStage,
  event: 'started' | 'completed',
) => void | Promise<void>;

/** Exposes only closed tokens. Neither values nor thrown errors are passed to diagnostics. */
export async function observeModelStage<T>(
  observer: ModelStageObserver | undefined,
  stage: ModelStage,
  work: () => Promise<T>,
): Promise<T> {
  const report = (event: 'started' | 'completed') => {
    try {
      const pending = observer?.(stage, event);
      if (pending) Promise.resolve(pending).catch(() => undefined);
    } catch {
      // Diagnostics cannot alter consent, dispatch, source validation or the returned outcome.
    }
  };
  report('started');
  try {
    return await work();
  } finally {
    // Completed means this observed wait ended, including denial, failure or cancellation.
    report('completed');
  }
}
