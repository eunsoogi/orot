import { APPLE_PROVIDER_ID } from '@orot/provider-apple';
import type { RagConversationObserver } from '../../ragConversation/conversationObserver';
import type { AiFeatureLocalData } from './localData';
import { reportOpening } from './openingObservation';
import type { requireSelectedAi } from './provider';

/** Distinguish opening's local-access wait from model generation and review.
 * No preview or final work may bypass the original storage admission. */
export async function loadHealthSummaryOpeningData(
  load: () => Promise<AiFeatureLocalData>,
  selected: ReturnType<typeof requireSelectedAi>,
  signal: AbortSignal,
  observer?: RagConversationObserver,
) {
  const observe = Boolean(
    !signal.aborted &&
    (observer?.inputOrigin === 'shortcut' ||
      observer?.inputOrigin === 'composer') &&
    observer.onTaskStreamEvent &&
    !observer.suppressContextualOpening &&
    !observer.photoInput &&
    selected.provider.id === APPLE_PROVIDER_ID &&
    selected.option.privacyBoundary === 'on-device' &&
    !selected.remoteProcessing,
  );
  // The existing native opt-in sink independently allowlists the closed tuple.
  if (observe) reportOpening('opening_preflight', 'started', 'disease');
  let data: AiFeatureLocalData | undefined;
  let failed = false;
  try {
    data = await (observe
      ? observeHealthSummaryWhileCurrent(load, signal)
      : load());
  } catch {
    failed = true;
  }
  if (observe)
    reportOpening(
      'opening_preflight',
      signal.aborted
        ? 'cancelled'
        : failed
          ? 'failed'
          : data?.readHealthContext
            ? 'completed'
            : 'unavailable',
      'disease',
    );
  return data;
}

/** Stop retires this request's wait, not an already-started shared/local operation. */
export async function observeHealthSummaryWhileCurrent<T>(
  run: () => Promise<T>,
  signal: AbortSignal,
): Promise<T | undefined> {
  if (signal.aborted) return;
  let stop = () => {};
  const cancelled = new Promise<undefined>(resolve => {
    stop = () => resolve(undefined);
    signal.addEventListener('abort', stop, { once: true });
  });
  try {
    // Observe late rejections without waiting for retired ownership.
    const operation = Promise.resolve().then(() =>
      signal.aborted ? undefined : run(),
    );
    return await Promise.race([operation, cancelled]);
  } finally {
    signal.removeEventListener('abort', stop);
  }
}
