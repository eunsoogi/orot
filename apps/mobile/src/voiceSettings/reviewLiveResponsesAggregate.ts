import type { SettingsDisclosureSummary } from '../agent/execution/settingsDisclosureSummary';
import { t } from '../i18n';
import {
  isLiveResponsesBackend,
  liveResponsesProviderId,
  liveResponsesRecipient,
  type LiveResponsesBackend,
} from './liveResponsesSettingsIdentity';

export type ReviewedLiveResponsesAggregate = Readonly<{
  backend: LiveResponsesBackend;
}>;
const receipts = new WeakMap<
  ReviewedLiveResponsesAggregate,
  { signal: AbortSignal; current: () => boolean }
>();

/** Both Settings entry points must show exactly this v2 operation and result
 * boundary. No prior model approval can manufacture this one-use receipt. */
export async function reviewLiveResponsesAggregate(input: {
  backend: LiveResponsesBackend;
  signal: AbortSignal;
  current: () => boolean;
  confirm: (
    summary: SettingsDisclosureSummary,
    signal: AbortSignal,
  ) => Promise<boolean>;
}): Promise<ReviewedLiveResponsesAggregate | undefined> {
  const { backend, signal } = input;
  const current = () => !signal.aborted && input.current();
  if (!isLiveResponsesBackend(backend) || !current()) return;
  const allowed = await input.confirm(
    Object.freeze({
      providerId: liveResponsesProviderId,
      modelId: backend,
      recipient: liveResponsesRecipient,
      subtitle: t('modelSettings.liveResponsesConsentTitle'),
      information: t('modelSettings.liveResponsesConsentScope', {
        model: backend,
      }),
      notice: t('modelSettings.liveResponsesConsentNotice'),
    }),
    signal,
  );
  if (!allowed || !current()) return;
  const receipt = Object.freeze({ backend });
  receipts.set(receipt, { signal, current });
  return receipt;
}

export function takeReviewedLiveResponsesAggregate(
  receipt: ReviewedLiveResponsesAggregate,
  backend: LiveResponsesBackend,
  signal: AbortSignal,
): (() => boolean) | undefined {
  const owner = receipts.get(receipt);
  if (
    !owner ||
    receipt.backend !== backend ||
    owner.signal !== signal ||
    !owner.current()
  )
    return;
  receipts.delete(receipt);
  return owner.current;
}
