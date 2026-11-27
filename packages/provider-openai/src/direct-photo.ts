import { captureDirectPhotoGroup } from './direct-photo-group';
export { isBoundedInlineJPEG } from './direct-photo-jpeg';
import type { LanguageModelProvider } from '@orot/model-runtime';
import { CompletedContinuationCache } from './completed-continuation';
import { cancellableStream } from './cancellable-stream';
import type { ChatGPTPlanProviderOptions } from './provider';
import { createChatGPTPlanStream } from './stream';

export type ApprovedPhoto = Readonly<{
  text: string;
  jpegBase64?: string;
  jpegBase64s?: readonly string[];
  signal: AbortSignal;
  /** Correlates the native photo ticket to its owning local reply; never provider input. */
  localReplyId?: string;
  /** Synchronous exact request/selection/credential fence at native admission. */
  isCurrent: () => boolean;
  /** Optional app-owned state handoff after the last JavaScript ownership check. */
  beforeNativeStart?: () => boolean;
}>;

export type DirectPhotoSender = (input: ApprovedPhoto) => Promise<string | null>;

const senders = new WeakMap<
  LanguageModelProvider,
  Readonly<{ model: string; send: DirectPhotoSender }>
>();
/** An ordinary language-model provider (or shallow copy) has no image dispatch port. */
export function chatGPTPlanDirectPhoto(provider: LanguageModelProvider) {
  return senders.get(provider);
}

export function registerChatGPTPlanDirectPhoto(
  provider: LanguageModelProvider,
  options: ChatGPTPlanProviderOptions,
  nextRequestID: () => string,
) {
  const bridge = options.bridge;
  const startPhotoResponse = bridge.startPhotoResponse;
  if (options.model.supportsDirectPhoto !== true || !startPhotoResponse) return;
  const account = options.issuedClientID;
  const model = options.model.slug;
  // Reuse cancellation and stream validation, not the generic text/tools transport.
  // The real bridge receives only one photo envelope, never a placeholder prompt.
  const send: DirectPhotoSender = async ({
    text,
    jpegBase64,
    jpegBase64s,
    signal,
    localReplyId,
    isCurrent,
    beforeNativeStart,
  }) => {
    const photos = captureDirectPhotoGroup(jpegBase64s ?? [jpegBase64]);
    if (
      signal.aborted ||
      !isCurrent() ||
      text.length > 4000 ||
      !photos ||
      (localReplyId !== undefined && !/^photo-reply:[0-9a-f]{32}$/.test(localReplyId)) ||
      (jpegBase64s && jpegBase64 !== undefined)
    )
      return null;
    const current = () => !signal.aborted && isCurrent();
    const photo = Object.freeze(
      photos.length === 1 ? { text, jpegBase64: photos[0]! } : { text, jpegBase64s: photos },
    );
    const transport = {
      startResponse(id: string) {
        if (!current() || beforeNativeStart?.() === false || !current())
          return Promise.reject(new Error('Photo owner changed.'));
        return startPhotoResponse.call(bridge, id, account, {
          model,
          directPhoto: photo,
        });
      },
      listModels: bridge.listModels.bind(bridge),
      subscribe: bridge.subscribe.bind(bridge),
      cancelResponse: bridge.cancelResponse.bind(bridge),
    };
    const stream = cancellableStream(
      createChatGPTPlanStream(
        { ...options, bridge: transport },
        localReplyId === undefined ? nextRequestID : () => localReplyId,
        { messages: [{ role: 'user', content: '' }] },
        new CompletedContinuationCache(),
      ),
      signal,
    );
    for await (const result of stream) {
      if (!current() || !result.ok || result.value.type === 'tool_call') return null;
      if (result.value.type === 'completed') {
        const response = result.value.response;
        if (response.finishReason !== 'complete' || response.toolCalls.length) return null;
        return response.text.trim() || null;
      }
    }
    return null;
  };
  senders.set(provider, Object.freeze({ model, send }));
}
