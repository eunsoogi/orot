import {
  chatGPTPlanDirectPhoto,
  captureDirectPhotoGroup,
} from '@orot/provider-openai';
import { t } from '../../i18n';
import type { SelectedAiResolution } from './provider';

type PhotoSelection = Extract<SelectedAiResolution, { status: 'ready' }>;
export type ConversationPhotoImageDecision = Readonly<{
  providerName: string;
  modelName: string;
  recipient: string;
  includesPrompt: boolean;
  transfer: 'image';
}>;
type Outcome =
  | { status: 'answer'; text: string }
  | {
      status:
        'unsupported' | 'invalid' | 'refused' | 'cancelled' | 'unavailable';
    };

/** One caller-owned prepared image and one explicit approval. No OCR fallback, retention, tools or history. */
export function createConversationPhotoImageSend(input: {
  readonly selected: PhotoSelection;
  readonly jpegBase64?: string;
  readonly jpegBase64s?: readonly string[];
  readonly prompt: string;
  readonly signal: AbortSignal;
  /** Must combine attachment generation, ownership, live credential and exact selection. */
  readonly isCurrent: () => boolean;
  /** Optional exact locally-owned handoff, sampled immediately before native start. */
  readonly beforeNativeStart?: () => boolean;
  /** Subscribe to attachment, selection and credential invalidations while native work is active. */
  readonly subscribeInvalidation: (listener: () => void) => () => void;
  readonly confirm: (
    decision: ConversationPhotoImageDecision,
    signal: AbortSignal,
  ) => Promise<boolean>;
}): () => Promise<Outcome> {
  const {
    selected,
    signal: ownerSignal,
    isCurrent,
    beforeNativeStart,
    confirm,
    subscribeInvalidation,
  } = input;
  let photo =
    input.jpegBase64 !== undefined && input.jpegBase64s !== undefined
      ? undefined
      : captureDirectPhotoGroup(input.jpegBase64s ?? [input.jpegBase64]);
  const prompt = input.prompt.trim();
  const { provider, modelId, recipient } = selected;
  const sender = chatGPTPlanDirectPhoto(provider);
  const eligible =
    sender?.model === modelId &&
    selected.remoteProcessing &&
    selected.selection.providerId === provider.id &&
    selected.selection.modelId === modelId &&
    selected.option.provider === provider &&
    selected.option.modelId === modelId &&
    selected.option.privacyBoundary === 'selected-context-remote' &&
    recipient === t('nextVisit.recipient.chatgpt') &&
    Boolean(selected.option.displayName.trim());
  const decision = Object.freeze({
    providerName: provider.displayName,
    modelName: selected.option.displayName,
    recipient,
    includesPrompt: Boolean(prompt),
    transfer: 'image' as const,
  });
  let consumed = false;

  return async () => {
    if (consumed) return { status: 'cancelled' };
    consumed = true;
    const jpegBase64 = photo;
    photo = undefined;
    const controller = new AbortController();
    const signal = controller.signal;
    const stop = () => controller.abort();
    const current = () => {
      try {
        return !signal.aborted && !ownerSignal.aborted && isCurrent();
      } catch {
        return false;
      }
    };
    let unsubscribe: (() => void) | undefined;
    ownerSignal.addEventListener('abort', stop, { once: true });
    try {
      if (!current()) return { status: 'cancelled' };
      if (!eligible || !sender) return { status: 'unsupported' };
      unsubscribe = subscribeInvalidation(stop);
      if (!current()) return { status: 'cancelled' };
      if (!jpegBase64 || prompt.length > 4000) return { status: 'invalid' };
      let cancel!: () => void;
      const cancelled = new Promise<false>(resolve => {
        cancel = () => resolve(false);
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) cancel();
      });
      let approved: boolean;
      try {
        approved = await Promise.race([
          cancelled,
          Promise.resolve().then(() => current() && confirm(decision, signal)),
        ]);
      } finally {
        signal.removeEventListener('abort', cancel);
      }
      if (!current()) return { status: 'cancelled' };
      if (!approved) return { status: 'refused' };
      const text = await sender.send({
        text: prompt,
        ...(jpegBase64.length === 1
          ? { jpegBase64: jpegBase64[0]! }
          : { jpegBase64s: jpegBase64 }),
        signal,
        isCurrent: current,
        beforeNativeStart,
      });
      if (!current()) return { status: 'cancelled' };
      return text ? { status: 'answer', text } : { status: 'unavailable' };
    } catch {
      return { status: current() ? 'unavailable' : 'cancelled' };
    } finally {
      ownerSignal.removeEventListener('abort', stop);
      try {
        unsubscribe?.();
      } catch {
        /* No disposal error changes a terminal result. */
      }
    }
  };
}
