import type { SettingsDisclosureSummary } from '../agent/execution/settingsDisclosureSummary';
import { t } from '../i18n';
import { conversationTransmissionCopy } from '../agent/execution/conversationTransmissionDisclosure';
import {
  liveVoiceModelId,
  liveVoiceRecipient,
} from '../agent/execution/liveVoiceSettingsIdentity';
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
  { signal: AbortSignal; current: () => boolean; commonTools: boolean }
>();

/** Both Settings entry points must show exactly this v2 operation and result
 * boundary. No prior model approval can manufacture this one-use receipt. */
export async function reviewLiveResponsesAggregate(input: {
  backend: LiveResponsesBackend;
  commonTools?: true;
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
  const common = input.commonTools === true;
  const shared = conversationTransmissionCopy('live-local-tools');
  const allowed = await input.confirm(
    Object.freeze({
      providerId: liveResponsesProviderId,
      modelId: backend,
      recipient: liveResponsesRecipient,
      subtitle: common
        ? shared.subtitle
        : t('modelSettings.liveResponsesConsentTitle'),
      information: common
        ? [
            t('modelSettings.liveConversationAudioTransmission', {
              recipient: liveVoiceRecipient,
              model: liveVoiceModelId,
            }),
            shared.information,
            t('modelSettings.liveResponsesConsentScope', { model: backend }),
          ].join('\n')
        : t('modelSettings.liveResponsesConsentScope', { model: backend }),
      notice: common
        ? shared.notice
        : t('modelSettings.liveResponsesConsentNotice'),
    }),
    signal,
  );
  if (!allowed || !current()) return;
  const receipt = Object.freeze({ backend });
  receipts.set(receipt, { signal, current, commonTools: common });
  return receipt;
}

export function takeReviewedLiveResponsesAggregate(
  receipt: ReviewedLiveResponsesAggregate,
  backend: LiveResponsesBackend,
  signal: AbortSignal,
) {
  const owner = receipts.get(receipt);
  if (
    !owner ||
    receipt.backend !== backend ||
    owner.signal !== signal ||
    !owner.current()
  )
    return;
  receipts.delete(receipt);
  return Object.assign(() => owner.current(), {
    commonTools: owner.commonTools,
  });
}
