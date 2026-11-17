import { createChatGPTPlanProvider } from '@orot/provider-openai';
import { FakeBridge } from '../../../../../../packages/provider-openai/__tests__/providerTestSupport';
import { createPublicWebEvidence } from '../publicWebEvidence';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';

// Use the real adapter/error mapper, not an already-classified ProviderError mock.
test.each([
  { kind: 'provider' as const, code: 'safety_refusal' },
  { kind: 'provider' as const, code: 'content_filter' },
  { kind: 'malformed_response' as const },
])(
  'native refusal/invalid structures remain terminal through search: %p',
  async error => {
    const bridge = new FakeBridge();
    const startPublicWebSearch = jest.fn(async (id: string) => {
      bridge.emit({ requestId: id, type: 'failed', error });
    });
    const provider = createChatGPTPlanProvider({
      bridge: Object.assign(bridge, { startPublicWebSearch }),
      issuedClientID: 'synthetic-account',
      model: { slug: 'synthetic', displayName: 'Synthetic' },
      requestIDFactory: () => 'synthetic-search',
    });
    const run = publicEvidenceFixture();
    run.search.mockImplementation((request, options) =>
      provider.searchPublicWeb!(request, options),
    );
    const evidence = createPublicWebEvidence({
      ...run,
      recoverUnavailable: true,
    })!;
    await expect(evidence.tool.search(run.request)).rejects.toThrow();
    expect(startPublicWebSearch).toHaveBeenCalledTimes(1);
    expect(evidence.snapshot().references).toHaveLength(0);
  },
);
