import {
  liveVoiceModelId,
  liveVoiceProviderId,
  liveVoiceRecipient,
} from '../agent/execution/liveVoiceSettingsIdentity';
import type { SettingsDisclosureSummary } from '../agent/execution/settingsDisclosureSummary';
import { t } from '../i18n';
import {
  reviewLiveResponsesAggregate,
  type ReviewedLiveResponsesAggregate,
} from './reviewLiveResponsesAggregate';
import {
  isLiveResponsesBackend,
  type LiveResponsesBackend,
} from './liveResponsesSettingsIdentity';

export type OpenAiVoicePair = Readonly<{
  speechModel: typeof liveVoiceModelId;
  backendModel: LiveResponsesBackend;
  accountRevision: number;
}>;

/** Both choices must belong to the same current, explicitly refreshed catalog. */
export function selectOpenAiVoicePair(input: {
  readonly revision: number | null;
  readonly fresh: boolean;
  readonly speechIds: readonly string[];
  readonly toolIds: readonly string[];
  readonly speechModel: string | undefined;
  readonly backendModel: string | undefined;
}): OpenAiVoicePair | undefined {
  const { revision, speechModel, backendModel } = input;
  if (
    !input.fresh ||
    revision === null ||
    speechModel !== liveVoiceModelId ||
    !input.speechIds.includes(speechModel) ||
    !isLiveResponsesBackend(backendModel) ||
    !input.toolIds.includes(backendModel)
  )
    return undefined;
  return Object.freeze({
    speechModel,
    backendModel,
    accountRevision: revision,
  });
}

/** Consent is a pair intake boundary. No stage or store write runs on a single Allow. */
export async function reviewOpenAiVoicePair(input: {
  readonly pair: OpenAiVoicePair;
  readonly signal: AbortSignal;
  readonly current: () => boolean;
  readonly review: (
    summary: SettingsDisclosureSummary,
    signal: AbortSignal,
  ) => Promise<boolean>;
  readonly commit: (ownership: {
    readonly pair: OpenAiVoicePair;
    readonly reviewedAggregate: ReviewedLiveResponsesAggregate;
    readonly signal: AbortSignal;
    readonly current: () => boolean;
  }) => Promise<void>;
}): Promise<boolean> {
  const { pair, signal, review, commit } = input;
  const current = () => !signal.aborted && input.current();
  if (!current()) return false;
  const speech = await review(
    {
      providerId: liveVoiceProviderId,
      modelId: pair.speechModel,
      recipient: liveVoiceRecipient,
      subtitle: t('modelSettings.liveVoiceConsentTitle'),
      information: t('modelSettings.liveVoiceConsentScope'),
      notice: t('modelSettings.liveVoiceConsentNotice'),
    },
    signal,
  );
  if (!speech || !current()) return false;
  const reviewedAggregate = await reviewLiveResponsesAggregate({
    backend: pair.backendModel,
    signal,
    current,
    confirm: review,
  });
  if (!reviewedAggregate || !current()) return false;
  await commit({ pair, reviewedAggregate, signal, current });
  return current();
}
