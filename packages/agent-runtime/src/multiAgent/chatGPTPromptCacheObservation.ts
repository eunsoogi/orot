import type { LanguageModelResponse } from '@orot/model-runtime';
import { reportModelStage, type ModelStageObserver } from './modelStageDiagnostics';

/** Classify the metric attached by the provider to this accepted response.
 * Zero is a reported count, not proof about all phases of a steered turn,
 * a cache-key miss, cross-turn continuity or any latency savings. */
export function observeChatGPTPromptCache(
  observer: ModelStageObserver | undefined,
  providerId: string,
  usage: LanguageModelResponse['usage'],
): void {
  if (!observer || !providerId.startsWith('chatgpt-plan:')) return;
  const count = usage?.cachedInputTokens;
  const input = usage?.inputTokens;
  const status =
    typeof count !== 'number' ||
    !Number.isSafeInteger(count) ||
    count < 0 ||
    typeof input !== 'number' ||
    !Number.isSafeInteger(input) ||
    count > input
      ? 'unknown'
      : count === 0
        ? 'reported_zero'
        : 'reported_positive';
  reportModelStage(observer, `chatgpt_prompt_cache_${status}`, 'completed');
}
