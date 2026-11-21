import { nativePublisherPageLoader } from './nativePublisherPage';
import { publisherHtmlByteLimit, publisherSeeds } from './medlinePlusSeeds';

function bridgeFixture(
  load = jest.fn<Promise<string>, [string, string]>(
    async () => '<head><title>Publisher</title></head>',
  ),
) {
  return { load, cancel: jest.fn() };
}
const url = publisherSeeds[0].url;
const request = (signal: AbortSignal) => ({
  url,
  bytes: publisherHtmlByteLimit,
  signal,
});

test('only exact fixed URLs and bounded metadata reach the native-only transport', async () => {
  const bridge = bridgeFixture();
  const loader = nativePublisherPageLoader(bridge)!;
  const controller = new AbortController();
  await expect(
    loader({ ...request(controller.signal), url: url + '?q=PRIVATE_SENTINEL' }),
  ).rejects.toThrow();
  await expect(
    loader({ ...request(controller.signal), url: 'https://example.org/' }),
  ).rejects.toThrow();
  await expect(
    loader({ ...request(controller.signal), bytes: 1 }),
  ).rejects.toThrow();
  expect(bridge.load).not.toHaveBeenCalled();
  await expect(loader(request(controller.signal))).resolves.toMatchObject({
    status: 200,
    finalUrl: url,
  });
  expect(bridge.load).toHaveBeenCalledWith(
    url,
    expect.stringMatching(/^publisher-/),
  );
});

test('an aborted native operation loses its response, and missing native support has no network fallback', async () => {
  let finish!: (html: string) => void;
  const bridge = bridgeFixture(
    jest.fn<Promise<string>, [string, string]>(
      async () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    ),
  );
  const loader = nativePublisherPageLoader(bridge)!;
  const controller = new AbortController();
  const response = loader(request(controller.signal));
  controller.abort();
  expect(bridge.cancel).toHaveBeenCalledWith(bridge.load.mock.calls[0][1]);
  finish('<head><title>Late publisher content</title></head>');
  await expect(response).rejects.toThrow();
  expect(nativePublisherPageLoader()).toBeUndefined();
});
