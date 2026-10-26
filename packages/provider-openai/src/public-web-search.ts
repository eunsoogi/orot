import {
  providerFailure,
  providerSuccess,
  type ProviderResult,
  type PublicWebSearchResponse,
} from '@orot/model-runtime';
import type { ChatGPTPlanProviderOptions } from './provider';
import type { ChatGPTPlanWebSearchResult } from './native-contract';
import { toProviderError } from './errors';

const malformed = () =>
  providerFailure<PublicWebSearchResponse>({
    code: 'internal_error',
    message: 'ChatGPT returned invalid public web-search evidence.',
    retryable: false,
  });

// Public query text may include Unicode, but C0, DEL and C1 controls stay out of dispatch.
function hasQueryControlCharacters(query: string): boolean {
  return [...query].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });
}

/** One isolated selected-account request. Never enters the private function continuation cache.
 * Local cancellation is a request to stop, not an acknowledgement that remote work stopped. */
export function searchPublicWeb(
  options: ChatGPTPlanProviderOptions,
  requestID: string,
  query: string,
  signal?: AbortSignal,
): Promise<ProviderResult<PublicWebSearchResponse>> {
  const start = options.bridge.startPublicWebSearch;
  if (
    !start ||
    typeof query !== 'string' ||
    !query ||
    query !== query.trim() ||
    [...query].length > 240 ||
    hasQueryControlCharacters(query)
  ) {
    return Promise.resolve(
      providerFailure({
        code: 'invalid_request',
        message: 'The public search query is invalid.',
        retryable: false,
      }),
    );
  }
  return new Promise((resolve) => {
    let settled = false,
      cancelRequested = false,
      started = false;
    let text = '',
      textBytes = 0,
      unsubscribe = () => {};
    const cancelNative = () => {
      try {
        options.bridge.cancelResponse(requestID);
      } catch {
        /* Cancellation has no remote acknowledgement. */
      }
    };
    const finish = (result: ProviderResult<PublicWebSearchResponse>, cancel = false) => {
      if (settled) return;
      settled = true;
      cancelRequested = cancel;
      unsubscribe();
      signal?.removeEventListener('abort', abort);
      if (cancel && started) cancelNative();
      resolve(result);
    };
    const abort = () =>
      finish(
        providerFailure({
          code: 'provider_unavailable',
          message: 'The public search was cancelled.',
          retryable: false,
        }),
        true,
      );
    if (signal?.aborted) {
      abort();
      return;
    }
    try {
      unsubscribe = options.bridge.subscribe((event) => {
        if (settled || event.requestId !== requestID) return;
        if (event.type === 'text_delta') {
          if (typeof event.text !== 'string') {
            finish(malformed(), true);
            return;
          }
          textBytes += utf8Bytes(event.text);
          // A supplementary character split across SSE packets is four bytes, not
          // two replacement characters. Count only each delta, without rescanning all text.
          if (/[\ud800-\udbff]$/u.test(text) && /^[\udc00-\udfff]/u.test(event.text))
            textBytes -= 2;
          text += event.text;
          if (textBytes > 32_768) finish(malformed(), true);
        } else if (event.type === 'failed') finish(providerFailure(toProviderError(event.error)));
        else if (event.type === 'completed') {
          if (
            event.text !== text ||
            !text.trim() ||
            event.toolCalls?.length ||
            !validResult(event.webSearch)
          ) {
            finish(malformed(), true);
          } else finish(providerSuccess({ text, ...event.webSearch }));
        } else finish(malformed(), true);
      });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) {
        abort();
        return;
      }
      started = true;
      Promise.resolve(
        start.call(options.bridge, requestID, options.issuedClientID, {
          model: options.model.slug,
          publicWebQuery: query,
        }),
      ).then(
        () => {
          // A bridge may defer registration until after cancellation. Repeat the stop
          // request once it acknowledges start so an orphan cannot silently continue.
          if (cancelRequested) cancelNative();
        },
        (error) => finish(providerFailure(toProviderError(error)), true),
      );
    } catch (error) {
      finish(providerFailure(toProviderError(error)), true);
    }
  });
}

/** Native bridge packets remain untrusted, including their links and bounded metadata. */
function validResult(input: unknown): input is ChatGPTPlanWebSearchResult {
  if (!input || typeof input !== 'object') return false;
  const value = input as ChatGPTPlanWebSearchResult;
  return (
    value !== undefined &&
    Number.isInteger(value.callCount) &&
    value.callCount >= 1 &&
    value.callCount <= 2 &&
    Array.isArray(value.citations) &&
    value.citations.length > 0 &&
    value.citations.length <= 8 &&
    value.citations.every((citation) => {
      if (
        !citation ||
        typeof citation.title !== 'string' ||
        !citation.title.trim() ||
        citation.title.length > 256 ||
        typeof citation.url !== 'string' ||
        citation.url.length > 2048
      )
        return false;
      try {
        const url = new URL(citation.url);
        return (
          ['https:', 'http:'].includes(url.protocol) &&
          !!url.hostname &&
          !url.username &&
          !url.password
        );
      } catch {
        return false;
      }
    })
  );
}

/** Hermes need not expose TextEncoder before an AI workflow loads its polyfills. */
function utf8Bytes(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}
