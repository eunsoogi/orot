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
    data = await load();
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
