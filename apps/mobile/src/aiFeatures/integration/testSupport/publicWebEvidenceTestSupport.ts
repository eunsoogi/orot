import { providerSuccess } from '@orot/model-runtime';
import type { PublicWebSearch } from '@orot/model-runtime';
import type {
  EvidenceReference,
  ExecutionConsentPort,
} from '@orot/agent-runtime';
import { apple } from '../featureServiceFixtures';
import { requireSelectedAi } from '../provider';

/** Synthetic provider data shared by tool, consent, workflow and citation-control tests. */
export const publicResponse = {
  text: 'Synthetic cited web explanation.',
  callCount: 1,
  citations: [
    { title: 'Synthetic guideline', url: 'https://example.org/guideline' },
    { title: 'Synthetic public resource', url: 'https://example.net/resource' },
  ],
};
export const webReference: EvidenceReference = {
  sourceKind: 'external_medical',
  sourceId: 'public-web',
  sourceRevision: 'retrieved:2026-10-01T00:00:00.000Z',
  evidenceId: 'web-result-1',
  evidenceRevision: 'snapshot:1',
  effectiveTime: null,
  reviewState: 'unknown',
  locator: {
    kind: 'public_web_search',
    retrievedAt: '2026-10-01T00:00:00.000Z',
    sources: publicResponse.citations,
  },
};

export function publicEvidenceFixture() {
  const search = jest
    .fn<ReturnType<PublicWebSearch>, Parameters<PublicWebSearch>>()
    .mockResolvedValue(providerSuccess(publicResponse));
  const provider = {
    ...apple.provider,
    id: 'chatgpt-plan:synthetic:gpt-6-luna',
    searchPublicWeb: search,
  };
  const selected = requireSelectedAi({
    status: 'ready',
    selection: { providerId: provider.id, modelId: 'gpt-6-luna' },
    option: { ...apple, provider, privacyBoundary: 'selected-context-remote' },
    provider,
    modelId: 'gpt-6-luna',
    recipient: 'Selected synthetic account',
    remoteProcessing: true,
  });
  const authorize = jest
    .fn<
      ReturnType<ExecutionConsentPort['authorize']>,
      Parameters<ExecutionConsentPort['authorize']>
    >()
    .mockResolvedValue('authorized');
  const controller = new AbortController();
  const request = {
    operationRunId: 'synthetic-run',
    operationKey: 'tool-2',
    input: { query: 'Public concept' },
    allowedScope: { sourceKinds: ['external_medical' as const] },
    resultLimit: 2,
    maxPayloadBytes: 65536,
    signal: controller.signal,
  };
  return {
    selected,
    search,
    authorize,
    controller,
    request,
    consent: { authorize },
  };
}
