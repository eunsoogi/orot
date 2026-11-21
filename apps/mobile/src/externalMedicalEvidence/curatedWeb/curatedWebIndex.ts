import {
  publisherAttribution,
  publisherHtmlByteLimit,
  publisherIndexLifetimeMs,
  publisherSeeds,
  publisherTimeoutMs,
} from './medlinePlusSeeds';
import { readPublisherHead } from './publisherHead';

type Document = {
  readonly title: string;
  readonly url: string;
  readonly summary: string;
  readonly attribution: typeof publisherAttribution;
};
type IndexedDocument = {
  document: Document;
  priority: Set<string>;
  metadata: Set<string>;
};
type Corpus = { indexedAt: number; pages: IndexedDocument[] };

type ExactPageLoader = (input: {
  readonly url: string;
  readonly bytes: number;
  readonly signal: AbortSignal;
}) => Promise<{ status: number; finalUrl: string; html: string }>;

const stopWords = new Set([
  'a',
  'an',
  'and',
  'are',
  'about',
  'how',
  'for',
  'in',
  'is',
  'of',
  'on',
  'or',
  'the',
  'to',
  'what',
  'when',
  'where',
  'which',
  'why',
]);
const tokens = (text: string) =>
  new Set(
    text
      .normalize('NFKC')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.slice(0, 320)
      .filter(token => !stopWords.has(token)) ?? [],
  );
// Strip only one common particle from an otherwise unknown Hangul token and
// only when the entire stem is a curated alias. Do not match words such as 수면제.
const koreanAliases = new Set(
  publisherSeeds.flatMap(seed =>
    [...tokens(seed.words)].filter(word => /^[가-힣]{2,}$/u.test(word)),
  ),
);
const koreanParticles = [
  '에대해서',
  '에대해',
  '으로는',
  '에서는',
  '에게는',
  '에서',
  '에게',
  '으로',
  '부터',
  '까지',
  '보다',
  '하고',
  '이랑',
  '이라도',
  '라도',
  '에는',
  '에도',
  '은',
  '는',
  '이',
  '가',
  '을',
  '를',
  '에',
  '도',
  '만',
  '로',
  '과',
  '와',
];
function localQueryTerms(query: string) {
  const terms = tokens(query.slice(0, 240));
  for (const word of [...terms]) {
    if (!/^[가-힣]+$/u.test(word) || koreanAliases.has(word)) continue;
    for (const suffix of koreanParticles) {
      if (!word.endsWith(suffix)) continue;
      const stem = word.slice(0, -suffix.length);
      if (!koreanAliases.has(stem)) continue;
      terms.add(stem);
      break;
    }
  }
  return terms;
}
function readAge(corpus: Corpus | undefined, now: number) {
  if (!corpus || !Number.isFinite(now)) return false;
  const age = now - corpus.indexedAt;
  return age >= 0 && age < publisherIndexLifetimeMs;
}

/** The only ingress for network data is explicit corpus refresh. Search closes
 * over a bounded in-memory index: it cannot change requests or start a refresh. */
export function createCuratedWebIndex(
  // A shipping loader needs native redirect rejection before any next request.
  loadExactPage: ExactPageLoader | undefined,
  now = Date.now,
) {
  let corpus: Corpus | undefined;
  let active: AbortController | undefined;
  async function refresh(outer: AbortSignal) {
    if (!loadExactPage) return 'unavailable' as const;
    if (outer.aborted) return 'cancelled' as const;
    if (active) return 'busy' as const;
    const controller = new AbortController();
    active = controller;
    let stop!: () => void;
    const stopped = new Promise<undefined>(resolve => {
      stop = () => resolve(undefined);
    });
    const cancel = () => {
      controller.abort();
      stop();
    };
    outer.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(cancel, publisherTimeoutMs);
    try {
      if (outer.aborted) return 'cancelled' as const;
      const pages = await Promise.race([
        // Fixed set, even if zero outstanding search requests exist.
        Promise.all(
          publisherSeeds.map(async seed => {
            try {
              const response = await loadExactPage({
                url: seed.url,
                bytes: publisherHtmlByteLimit,
                signal: controller.signal,
              });
              if (
                controller.signal.aborted ||
                response.status !== 200 ||
                response.finalUrl !== seed.url
              )
                return undefined;
              const head = readPublisherHead(response.html, seed.url);
              if (!head) return undefined;
              return {
                document: {
                  ...head,
                  url: seed.url,
                  attribution: publisherAttribution,
                },
                priority: tokens(seed.words),
                metadata: tokens(head.title + ' ' + head.summary),
              };
            } catch {
              return undefined;
            }
          }),
        ),
        stopped,
      ]);
      if (outer.aborted) return 'cancelled' as const;
      if (controller.signal.aborted || !pages) return 'unavailable' as const;
      const usable = pages.filter(
        (page): page is IndexedDocument => page !== undefined,
      );
      const at = now();
      if (!usable.length || !Number.isFinite(at)) return 'unavailable' as const;
      // Preserve a broader fresh index across a short partially successful refresh.
      if (readAge(corpus, at) && (corpus?.pages.length ?? 0) > usable.length)
        return 'retained' as const;
      corpus = { indexedAt: at, pages: usable };
      return usable.length === publisherSeeds.length
        ? ('ready' as const)
        : ('partial' as const);
    } finally {
      clearTimeout(timer);
      outer.removeEventListener('abort', cancel);
      if (active === controller) active = undefined;
    }
  }
  function search(query: string) {
    if (!corpus || !readAge(corpus, now())) {
      corpus = undefined;
      return { status: 'unavailable' } as const;
    }
    const terms = localQueryTerms(query);
    const matching = corpus.pages
      .map(page => ({
        document: page.document,
        rank: [...terms].reduce(
          (score, token) =>
            score +
            (page.priority.has(token) ? 5 : page.metadata.has(token) ? 1 : 0),
          0,
        ),
      }))
      .filter(page => page.rank > 0)
      .sort((a, b) => b.rank - a.rank);
    return {
      status: matching.length ? 'results' : 'empty',
      indexedAt: corpus.indexedAt,
      coverage: {
        indexed: corpus.pages.length,
        total: publisherSeeds.length,
        publisher: publisherAttribution,
      },
      sources: matching.slice(0, 4).map(page => page.document),
    } as const;
  }
  return { refresh, search };
}
