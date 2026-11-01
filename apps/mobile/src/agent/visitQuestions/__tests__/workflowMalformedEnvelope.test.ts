import {
  makeProvider,
  preparedContext,
  selectedOption,
  successfulOutputs,
} from '../testing/workflowFixtures';
import { runVisitQuestionWorkflow } from '../workflow';
import { providerSuccess } from '@orot/model-runtime';

test.each(['valid', 'malformed', 'unknown', 'cancelled', 'stale'] as const)(
  'repairs a malformed envelope after two searches while preserving validation: %s',
  async correction => {
    const fixture = preparedContext();
    const [firstSearch, valid] = successfulOutputs(
      fixture.initialEvidence,
      fixture.supplementalEvidence,
    );
    const secondCollection = await fixture.searchEvidence(
      'synthetic',
      1,
      'personal_record',
    );
    const revalidate = jest.fn(async () => true);
    const prepared = {
      ...fixture,
      revalidateEvidence: revalidate,
      evidence: {
        ...fixture.evidence,
        batch: { ...fixture.evidence.batch, items: [], coverage: [] },
      },
      searchEvidence: jest
        .fn()
        .mockResolvedValueOnce(fixture.evidence)
        .mockResolvedValueOnce(secondCollection),
    };
    const secondSearch = JSON.parse(firstSearch!) as {
      toolCalls: { id: string }[];
    };
    secondSearch.toolCalls[0]!.id = 'model-search-2';
    const malformed = JSON.parse(valid!) as { citations: unknown };
    malformed.citations = 'evidence-2';
    const corrected = JSON.parse(valid!) as { citations: unknown };
    if (correction === 'malformed') corrected.citations = 'evidence-2';
    if (correction === 'unknown') corrected.citations = ['unknown-evidence'];
    const controller = new AbortController();
    const { provider: rawProvider, requests } = makeProvider(
      [
        firstSearch!,
        JSON.stringify(secondSearch),
        JSON.stringify(malformed),
        JSON.stringify(corrected),
      ],
      (_request, index) => {
        if (index === 2 && correction === 'cancelled') controller.abort();
        if (index === 2 && correction === 'stale')
          revalidate.mockResolvedValue(false);
      },
    );
    const provider = {
      ...rawProvider,
      capabilities: { ...rawProvider.capabilities, structuredOutput: true },
      async generate(request: Parameters<typeof rawProvider.generate>[0]) {
        const result = await rawProvider.generate(request);
        if (!result.ok || result.value.finishReason !== 'complete')
          return result;
        return providerSuccess({
          ...result.value,
          structuredOutput: JSON.parse(result.value.text),
        });
      },
    };
    const { selection, option } = selectedOption(provider, 'on-device');
    const result = await runVisitQuestionWorkflow({
      prepared,
      selection,
      providerOptions: [option],
      signal: controller.signal,
    });
    if (correction === 'cancelled' || correction === 'stale') {
      expect(result.status).toBe(
        correction === 'cancelled' ? 'cancelled' : 'refresh_required',
      );
      expect(requests).toHaveLength(3);
    } else {
      expect(result.status).toBe(
        correction === 'valid' ? 'ready' : 'rejected_output',
      );
      expect(requests).toHaveLength(4);
      expect(JSON.stringify(requests[3])).toContain(
        'array of exact current evidenceId',
      );
      expect(JSON.stringify(requests[3])).not.toContain('private-source-');
    }
  },
);
