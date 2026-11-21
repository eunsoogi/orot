/** Public-domain publisher topic pages, not its search API or a search result page.
 * https://medlineplus.gov/about/using/usingcontent/
 * https://medlineplus.gov/robots.txt
 */
const origin = 'https://medlineplus.gov/';
export const publisherAttribution =
  'Source: MedlinePlus, National Library of Medicine';
export const publisherSeeds = [
  { slug: 'healthysleep', words: 'healthy sleep sleep hygiene 수면 숙면' },
  {
    slug: 'highbloodpressure',
    words: 'high blood pressure hypertension 혈압 고혈압',
  },
  {
    slug: 'arrhythmia',
    words: 'arrhythmia heart rhythm irregular heartbeat 부정맥 심박수',
  },
  {
    slug: 'exerciseandphysicalfitness',
    words: 'exercise physical activity fitness walking 운동 걷기 신체활동',
  },
  { slug: 'dehydration', words: 'dehydration hydration water 탈수 수분' },
  { slug: 'nutrition', words: 'nutrition food nutrients 영양 식사 식단' },
].map(seed => ({ ...seed, url: origin + seed.slug + '.html' }));

export const publisherHtmlByteLimit = 96 * 1024;
export const publisherTimeoutMs = 8_000;
export const publisherIndexLifetimeMs = 24 * 60 * 60 * 1000;
