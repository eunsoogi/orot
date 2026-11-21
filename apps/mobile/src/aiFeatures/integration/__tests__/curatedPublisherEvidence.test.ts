import { finishRagConversation } from '../finishRagConversation';
import { readColdConversationSearch } from '../coldConversationSearch';
import { referenceOnly } from '../../../diseaseHypotheses/resultValidation';
import { createCuratedWebIndex } from '../../../externalMedicalEvidence/curatedWeb/curatedWebIndex';
import { APPLE_FOUNDATION_MODEL_SELECTION_ID } from '../../../providers/selection/options';
import {
  createCuratedPublisherEvidence,
  explicitPublisherSearch,
  selectedOnDeviceApple,
} from '../curatedPublisherEvidence';
import { conversationPublicSearchPlan } from '../conversationPublicSearchPlan';

test('only explicit requested local web search under Apple on-device opts in', () => {
  expect(explicitPublisherSearch('수면 정보 웹검색해 줘')).toBe(true);
  expect(explicitPublisherSearch('Can you search the web about sleep?')).toBe(
    true,
  );
  for (const message of [
    '수면이 왜 중요해?',
    '웹검색이 뭐야?',
    '수면 정보 웹검색하지 마',
    'Please do not search the web',
  ]) {
    expect(explicitPublisherSearch(message)).toBe(false);
  }
  const apple = {
    providerId: 'apple-foundation-models',
    modelId: APPLE_FOUNDATION_MODEL_SELECTION_ID,
  };
  expect(selectedOnDeviceApple(apple)).toBe(true);
  expect(selectedOnDeviceApple({ ...apple, remoteProcessing: true })).toBe(
    false,
  );
  expect(
    selectedOnDeviceApple({
      ...apple,
      providerId: 'apple-private-cloud-compute',
    }),
  ).toBe(false);
  expect(
    selectedOnDeviceApple({ ...apple, providerId: 'chatgpt-plan:synthetic' }),
  ).toBe(false);
});

test('local results run before Apple generation without a remote tool or artificial model charge', async () => {
  const loadExact = jest.fn(async ({ url }: { url: string }) => ({
    status: 200,
    finalUrl: url,
    html: '<head><title>Public title</title><meta name="description" content="Public synopsis"></head>',
  }));
  const signal = new AbortController().signal;
  const index = createCuratedWebIndex(loadExact, () => 100);
  await index.refresh(signal);
  const local = createCuratedPublisherEvidence(undefined, index.search);
  const remote = { search: jest.fn() };
  const plan = await conversationPublicSearchPlan({
    external: { curatedSearch: local.search, publicWebTool: remote },
    runId: 'synthetic-run',
    question: '수면에 대해 웹검색해줘 PRIVATE_SENTINEL',
    signal,
  } as unknown as Parameters<typeof conversationPublicSearchPlan>[0]);
  expect(plan.chargeEagerSearch).toBe(false);
  expect(plan.initialSearch).toBeUndefined();
  expect(remote.search).not.toHaveBeenCalled();
  expect(loadExact).toHaveBeenCalledTimes(6);
  expect(JSON.stringify(loadExact.mock.calls)).not.toContain(
    'PRIVATE_SENTINEL',
  );
  if (plan.eager.status !== 'success')
    throw Error('Expected local public citations');
  const reference = referenceOnly(plan.eager.batch.items[0]);
  expect(reference.locator).toMatchObject({
    provider: 'Orot publisher index',
    attribution: 'Source: MedlinePlus, National Library of Medicine',
    sources: [{ url: 'https://medlineplus.gov/healthysleep.html' }],
  });
  expect(reference.evidenceId).toBe('publisher-web-result-1');
  expect(local.validates(reference)).toBe(true);
  const hostedID = { ...reference, evidenceId: 'web-result-1' };
  expect(local.validates(hostedID)).toBe(false);
  expect(() =>
    createCuratedPublisherEvidence(
      { ...local.snapshot(), references: [hostedID] },
      index.search,
    ),
  ).toThrow();
  expect(() =>
    createCuratedPublisherEvidence(
      { ...local.snapshot(), sequence: 0 },
      index.search,
    ),
  ).toThrow();
  const restored = createCuratedPublisherEvidence(
    local.snapshot(),
    index.search,
  );
  expect(restored.validates(reference)).toBe(true);
  expect(loadExact).toHaveBeenCalledTimes(6);
});

test('an unready local index prompts explicit Settings refresh without dispatching or restoring it', async () => {
  const exact = jest.fn();
  const signal = new AbortController().signal;
  const index = createCuratedWebIndex(exact);
  const local = createCuratedPublisherEvidence(undefined, index.search, true);
  const remote = { search: jest.fn() };
  const plan = await conversationPublicSearchPlan({
    external: { curatedSearch: local.search, publicWebTool: remote },
    runId: 'synthetic-run',
    question: '수면에 대해 웹검색해줘',
    signal,
  } as unknown as Parameters<typeof conversationPublicSearchPlan>[0]);
  expect(exact).not.toHaveBeenCalled();
  expect(remote.search).not.toHaveBeenCalled();
  expect(plan.currentSearch).toEqual({
    status: 'unavailable',
    reason: 'publisher_refresh_required',
  });
  const saved = readColdConversationSearch({ publicSearch: plan.coldSearch });
  expect(saved).toEqual(plan.coldSearch);
  expect(() =>
    readColdConversationSearch({
      publicSearch: { ...plan.coldSearch, charged: true },
    }),
  ).toThrow();
  const outcome = await finishRagConversation({
    outcome: { status: 'answer', answer: 'Local answer.', citations: [] },
    retention: { finish: async value => ({ outcome: value }) },
    signal,
    continuation: false,
    publicSearch: plan.currentSearch,
  } as Parameters<typeof finishRagConversation>[0]);
  expect(outcome).toMatchObject({
    status: 'answer',
    answer: expect.stringContaining('검색 자료 갱신'),
  });
  expect(exact).not.toHaveBeenCalled();
});
