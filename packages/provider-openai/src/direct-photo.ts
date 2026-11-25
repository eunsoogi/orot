import type { LanguageModelProvider } from '@orot/model-runtime';
import { CompletedContinuationCache } from './completed-continuation';
import { cancellableStream } from './cancellable-stream';
import type { ChatGPTPlanProviderOptions } from './provider';
import { createChatGPTPlanStream } from './stream';

export type ApprovedPhoto = Readonly<{
  text: string;
  jpegBase64: string;
  signal: AbortSignal;
  /** Synchronous exact request/selection/credential fence at native admission. */
  isCurrent: () => boolean;
}>;

export type DirectPhotoSender = (input: ApprovedPhoto) => Promise<string | null>;

const senders = new WeakMap<
  LanguageModelProvider,
  Readonly<{ model: string; send: DirectPhotoSender }>
>();
const maxPhotoBytes = 2 * 1024 * 1024;
const maxBase64 = 4 * Math.ceil(maxPhotoBytes / 3);

/** Only accept bounded inline JPEG strings. ImageIO and the native decoder check the actual bytes. */
export function isBoundedInlineJPEG(value: string): boolean {
  if (
    typeof value !== 'string' ||
    value.length < 8 ||
    value.length > maxBase64 ||
    value.length % 4 !== 0 ||
    !value.startsWith('/9j/')
  )
    return false;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const data = padding ? value.slice(0, -padding) : value;
  return 3 * (value.length / 4) - padding <= maxPhotoBytes && !/[^A-Za-z0-9+/]/.test(data);
}

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
  const send: DirectPhotoSender = async ({ text, jpegBase64, signal, isCurrent }) => {
    if (signal.aborted || !isCurrent() || text.length > 4000 || !isBoundedInlineJPEG(jpegBase64))
      return null;
    const current = () => !signal.aborted && isCurrent();
    const photo = Object.freeze({ text, jpegBase64 });
    const transport = {
      startResponse(id: string) {
        if (!current()) return Promise.reject(new Error('Photo owner changed.'));
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
        nextRequestID,
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
