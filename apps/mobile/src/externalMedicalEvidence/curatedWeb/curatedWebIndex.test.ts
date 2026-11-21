import { createCuratedWebIndex } from './curatedWebIndex';
import {
  publisherAttribution,
  publisherHtmlByteLimit,
  publisherIndexLifetimeMs,
  publisherSeeds,
  publisherTimeoutMs,
} from './medlinePlusSeeds';

const html = (
  title: string,
  indexedLink: string,
  description = 'Publisher text.',
) =>
  `<!doctype html><html><head><title>${title}</title><link rel="canonical" href="${indexedLink}"><meta content="${description}" name="description"></head><body><script>UNRELATED</script></body></html>`;

test('only explicit refresh requests the fixed corpus; query text never affects network', async () => {
  const loader = jest.fn(async ({ url }: { url: string }) => ({
    status: 200,
    finalUrl: url,
    html: html(
      'Synthetic Publisher Page',
      url,
      'A reference about regular physical routines.',
    ),
  }));
  const index = createCuratedWebIndex(loader, () => 100);
  expect(index.search('PRIVATE_SENTINEL')).toEqual({ status: 'unavailable' });
  expect(loader).not.toHaveBeenCalled();
  expect(await index.refresh(new AbortController().signal)).toBe('ready');
  expect(loader.mock.calls.map(([request]) => request.url)).toEqual(
    publisherSeeds.map(seed => seed.url),
  );
  expect(
    loader.mock.calls.map(([request]) => Object.keys(request).sort()),
  ).toEqual(publisherSeeds.map(() => ['bytes', 'signal', 'url']));
  expect(index.search('고혈압에 대해 웹검색해줘')).toMatchObject({
    status: 'results',
    coverage: { indexed: 6, total: 6, publisher: publisherAttribution },
    sources: [
      {
        url: 'https://medlineplus.gov/highbloodpressure.html',
        attribution: publisherAttribution,
      },
    ],
  });
  expect(index.search('what is the unrelated PRIVATE_SENTINEL')).toMatchObject({
    status: 'empty',
    sources: [],
  });
  expect(index.search('수면제를 검색해줘')).toMatchObject({
    status: 'empty',
    sources: [],
  });
  expect(loader).toHaveBeenCalledTimes(publisherSeeds.length);
});

test('only same published canonical pages are indexed and partial coverage stays honest', async () => {
  const index = createCuratedWebIndex(async ({ url }) => ({
    status: 200,
    finalUrl: url.endsWith('arrhythmia.html')
      ? 'https://unapproved.example/'
      : url,
    html: html(
      'A publisher title',
      url.endsWith('nutrition.html') ? 'https://unapproved.example/' : url,
    ),
  }));
  expect(await index.refresh(new AbortController().signal)).toBe('partial');
  expect(index.search('탈수')).toMatchObject({
    status: 'results',
    coverage: { indexed: 4, total: 6 },
  });
  expect(index.search('영양')).toMatchObject({
    status: 'empty',
    coverage: { indexed: 4, total: 6 },
  });
});

test('expired indexes are not reused; missing transport remains unavailable', async () => {
  let at = 100;
  const index = createCuratedWebIndex(
    async ({ url }) => ({
      status: 200,
      finalUrl: url,
      html: html('Title', url),
    }),
    () => at,
  );
  expect(await index.refresh(new AbortController().signal)).toBe('ready');
  at += publisherIndexLifetimeMs;
  expect(index.search('수면')).toEqual({ status: 'unavailable' });
  const unsupported = createCuratedWebIndex(undefined);
  expect(await unsupported.refresh(new AbortController().signal)).toBe(
    'unavailable',
  );
});

test('cancellation and deadline discard late pages; no parallel refresh storms', async () => {
  jest.useFakeTimers();
  try {
    const pending: Array<() => void> = [];
    const signals: AbortSignal[] = [];
    const index = createCuratedWebIndex(
      async ({ url, signal }) =>
        new Promise(resolve => {
          signals.push(signal);
          pending.push(() =>
            resolve({ status: 200, finalUrl: url, html: html('Title', url) }),
          );
        }),
    );
    const first = new AbortController();
    const refresh = index.refresh(first.signal);
    expect(await index.refresh(new AbortController().signal)).toBe('busy');
    first.abort();
    expect(await refresh).toBe('cancelled');
    expect(signals.every(signal => signal.aborted)).toBe(true);
    pending.splice(0).forEach(complete => complete());
    const expires = index.refresh(new AbortController().signal);
    jest.advanceTimersByTime(publisherTimeoutMs);
    expect(await expires).toBe('unavailable');
    pending.splice(0).forEach(complete => complete());
    expect(index.search('수면')).toEqual({ status: 'unavailable' });
  } finally {
    jest.useRealTimers();
  }
});

test('scripts and fake tags do not enter snippets; oversized pages fail', async () => {
  const noScripts = createCuratedWebIndex(async ({ url }) => ({
    status: 200,
    finalUrl: url,
    html: html('Real &amp; inert', url).replace(
      '<head>',
      '<head><!-- <title>Fake</title> --><script>"<title>Fake</title>"</script>',
    ),
  }));
  expect(await noScripts.refresh(new AbortController().signal)).toBe('ready');
  expect(noScripts.search('수면')).toMatchObject({
    sources: [{ title: 'Real & inert', summary: 'Publisher text.' }],
  });
  const oversized = createCuratedWebIndex(async ({ url }) => ({
    status: 200,
    finalUrl: url,
    html:
      html('Title', url) + '가'.repeat(Math.ceil(publisherHtmlByteLimit / 3)),
  }));
  expect(await oversized.refresh(new AbortController().signal)).toBe(
    'unavailable',
  );
});
