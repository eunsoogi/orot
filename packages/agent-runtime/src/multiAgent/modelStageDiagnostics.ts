/** Observation boundaries, not provider-success or physical cancellation acknowledgments. */
type PromptCacheStage =
  | 'chatgpt_prompt_cache_unknown'
  | 'chatgpt_prompt_cache_reported_zero'
  | 'chatgpt_prompt_cache_reported_positive';
export type ModelStage =
  | 'consent_wait'
  | 'provider_wait'
  | 'evidence_check'
  | 'response_correction'
  | 'tool_search_wait'
  | PromptCacheStage;
export type ModelStageObserver = (
  stage: ModelStage,
  event: 'started' | 'completed',
) => void | Promise<void>;

export function reportModelStage(
  observer: ModelStageObserver | undefined,
  stage: ModelStage,
  event: 'started' | 'completed',
): void {
  try {
    const pending = observer?.(stage, event);
    if (pending) Promise.resolve(pending).catch(() => undefined);
  } catch {
    // Diagnostics cannot alter consent, dispatch, source validation or the returned outcome.
  }
}

/** Exposes only closed tokens. Neither values nor thrown errors are passed to diagnostics. */
export async function observeModelStage<T>(
  observer: ModelStageObserver | undefined,
  stage: ModelStage,
  work: () => Promise<T>,
): Promise<T> {
  reportModelStage(observer, stage, 'started');
  try {
    return await work();
  } finally {
    // Completed means this observed wait ended, including denial, failure or cancellation.
    reportModelStage(observer, stage, 'completed');
  }
}
