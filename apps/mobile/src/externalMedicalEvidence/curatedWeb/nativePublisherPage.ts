import { NativeModules } from 'react-native';
import { publisherHtmlByteLimit, publisherSeeds } from './medlinePlusSeeds';

type PublisherBridge = {
  load(url: string, requestId: string): Promise<string>;
  cancel(requestId: string): void;
};
let sequence = 0;

/** Missing native support means unavailable. Standard RN fetch follows redirects
 * on iOS and must not be used as a fallback for this fixed-origin download. */
export function nativePublisherPageLoader(
  bridge = NativeModules.CuratedPublisherPages as PublisherBridge | undefined,
) {
  if (typeof bridge?.load !== 'function' || typeof bridge.cancel !== 'function')
    return undefined;
  return async ({
    url,
    bytes,
    signal,
  }: {
    url: string;
    bytes: number;
    signal: AbortSignal;
  }) => {
    if (
      signal.aborted ||
      bytes !== publisherHtmlByteLimit ||
      !publisherSeeds.some(seed => seed.url === url)
    )
      throw new Error('Publisher page is unavailable.');
    const requestId = `publisher-${Date.now()}-${++sequence}`;
    const cancel = () => bridge.cancel(requestId);
    signal.addEventListener('abort', cancel, { once: true });
    try {
      const html = await bridge.load(url, requestId);
      if (signal.aborted || typeof html !== 'string')
        throw new Error('Publisher page is unavailable.');
      return { status: 200, finalUrl: url, html };
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  };
}
