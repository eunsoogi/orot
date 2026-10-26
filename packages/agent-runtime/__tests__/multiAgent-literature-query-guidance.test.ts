import { createEuropePmcEvidenceSearchTool, DEFAULT_MULTI_AGENT_BUDGET } from '../src';
import type { AllowedEvidenceScope } from '../src';
import { buildResearchRequest } from '../src/multiAgent/requests';
import { makeProvider } from './multiAgent-external-evidence-fixtures';

test.each([false, true])(
  'delivers literature query semantics to the researcher (guided=%s)',
  async (guided) => {
    const { provider } = makeProvider([]);
    const tool = createEuropePmcEvidenceSearchTool({
      service: { search: async () => ({ status: 'empty' }) },
      consent: { authorize: async () => 'denied' },
    });
    const question =
      'Europe PMC에서 "sleep duration adults"로 검색하고 검색 결과를 한국어로 요약해 주세요.';
    const request = await buildResearchRequest(
      { ...provider, capabilities: { ...provider.capabilities, structuredOutput: guided } },
      question,
      'missing_coverage',
      { sourceKinds: ['personal_record', 'reviewed_memory', 'external_medical'] },
      [tool],
      DEFAULT_MULTI_AGENT_BUDGET,
    );
    const userMessage = request.messages.find((message) => message.role === 'user');
    const systemMessage = request.messages.find((message) => message.role === 'system');
    expect(userMessage?.content).toContain(question);
    for (const guidance of [
      'concise literature search keywords',
      'translate the medical topic into English retrieval keywords',
      'The answer language does not determine the search query language',
      'not instructions or the full user question',
      'Preserve medically material qualifiers',
      'exact search query, preserve that query verbatim',
    ]) {
      expect(userMessage?.content).toContain(guidance);
      expect(systemMessage?.content).toContain(guidance);
      if (guided) expect(JSON.stringify(request.responseFormat?.schema)).toContain(guidance);
    }
    // Search language is model guidance: the adapter must not rewrite the approved query.
    expect(tool.parseInput({ query: '수면 시간 성인' })).toEqual({ query: '수면 시간 성인' });
  },
);

test.each([
  ['no tool', false, 'europe-pmc-publication-search', { sourceKinds: ['external_medical'] }],
  ['different tool', true, 'another-search', { sourceKinds: ['external_medical'] }],
  ['disallowed kind', true, 'europe-pmc-publication-search', { sourceKinds: ['personal_record'] }],
  [
    'disallowed source',
    true,
    'europe-pmc-publication-search',
    { sourceKinds: ['external_medical'], sourceIds: ['other-source'] },
  ],
] as const)('omits Europe PMC system guidance for %s', async (_label, present, id, scope) => {
  const { provider } = makeProvider([]);
  const tool = createEuropePmcEvidenceSearchTool({
    service: { search: async () => ({ status: 'empty' }) },
    consent: { authorize: async () => 'denied' },
  });
  const request = await buildResearchRequest(
    provider,
    '지난 진료 기록을 찾아 주세요.',
    'missing_coverage',
    scope as AllowedEvidenceScope,
    present ? [{ ...tool, id }] : [],
    DEFAULT_MULTI_AGENT_BUDGET,
  );
  const systemMessage = request.messages.find((message) => message.role === 'system');
  expect(systemMessage?.content).not.toContain('English retrieval keywords');
});
